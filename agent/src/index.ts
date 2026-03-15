/**
 * dep-resolver-agent — Entry point & orchestrator.
 *
 * This is the main pipeline that runs as a GitHub Action:
 *
 *   1. Read the webhook payload or alert number from inputs
 *   2. Fetch the full alert from the GitHub API
 *   3. Classify severity (low / medium / high)
 *   4. Route:
 *      - Low & Medium → AI generates fix → auto-create PR
 *      - High → notify team for human triage
 *   5. Log an audit summary
 */

import * as core from "@actions/core";
import * as github from "@actions/github";
import { GitHubClient } from "./github-client";
import { AlertClassifier } from "./classifier";
import { AIResolver } from "./ai-resolver";
import { PRCreator } from "./pr-creator";
import { Notifier } from "./notifier";
import type {
  ResolverConfig,
  DependabotAlert,
  ClassifiedAlert,
  NotificationChannel,
} from "./types";
import { DEFAULT_THRESHOLDS } from "./types";

// ---------------------------------------------------------------------------
// Config from GitHub Action inputs / environment
// ---------------------------------------------------------------------------

function loadConfig(): ResolverConfig {
  const githubToken = core.getInput("github-token", { required: true });
  const anthropicApiKey = core.getInput("anthropic-api-key", { required: true });

  const [owner, repo] = (
    core.getInput("repository") || process.env.GITHUB_REPOSITORY || ""
  ).split("/");

  if (!owner || !repo) {
    throw new Error(
      "Could not determine repository. Set the 'repository' input or GITHUB_REPOSITORY env var."
    );
  }

  const rawChannels = core.getInput("notification-channels") || "console,github-issue";
  const notificationChannels = rawChannels
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean) as NotificationChannel[];

  return {
    githubToken,
    anthropicApiKey,
    owner,
    repo,
    thresholds: DEFAULT_THRESHOLDS,
    notificationChannels,
    slackWebhookUrl: core.getInput("slack-webhook-url") || undefined,
    baseBranch: core.getInput("base-branch") || "main",
    dryRun: core.getInput("dry-run") === "true",
  };
}

// ---------------------------------------------------------------------------
// Determine which alert to process
// ---------------------------------------------------------------------------

async function getTargetAlert(
  ghClient: GitHubClient
): Promise<DependabotAlert | null> {
  // Option 1: Triggered by a dependabot_alert webhook event
  const payload = github.context.payload;
  if (payload.alert) {
    const alertNumber: number = payload.alert.number;
    core.info(`Webhook trigger: processing alert #${alertNumber}`);
    return ghClient.getAlert(alertNumber);
  }

  // Option 2: Manual trigger with an alert number input
  const alertNumberInput = core.getInput("alert-number");
  if (alertNumberInput) {
    const alertNumber = parseInt(alertNumberInput, 10);
    if (isNaN(alertNumber)) {
      throw new Error(`Invalid alert-number input: "${alertNumberInput}"`);
    }
    core.info(`Manual trigger: processing alert #${alertNumber}`);
    return ghClient.getAlert(alertNumber);
  }

  // Option 3: Process all open alerts (batch mode)
  if (core.getInput("process-all") === "true") {
    core.info("Batch mode: will process all open alerts.");
    return null; // Signal to the main function to fetch all
  }

  throw new Error(
    "No alert to process. Provide an alert via webhook, " +
      "'alert-number' input, or set 'process-all' to true."
  );
}

// ---------------------------------------------------------------------------
// Process a single classified alert
// ---------------------------------------------------------------------------

export async function processAlert(
  classified: ClassifiedAlert,
  aiResolver: AIResolver,
  prCreator: PRCreator,
  notifier: Notifier,
  dryRun: boolean
): Promise<void> {
  const { alert, severity, cvssScore } = classified;
  const pkg = alert.dependency.package;

  core.startGroup(
    `Alert #${alert.number}: ${pkg.name} (${severity.toUpperCase()}, CVSS ${cvssScore})`
  );

  try {
    if (severity === "high") {
      // ---------------------------------------------------------------
      // HIGH: Notify team, do NOT auto-create a PR
      // ---------------------------------------------------------------
      core.warning(
        `Alert #${alert.number} is HIGH severity — routing to human triage.`
      );

      if (!dryRun) {
        await notifier.notify(classified);
      } else {
        core.info("[DRY RUN] Would send notifications for high-severity alert.");
      }
    } else {
      // ---------------------------------------------------------------
      // LOW / MEDIUM: AI generates fix → create PR
      // ---------------------------------------------------------------
      core.info(
        `Alert #${alert.number} is ${severity.toUpperCase()} — generating AI fix…`
      );

      const fix = await aiResolver.resolve(classified);
      core.info(`[AI] Fix generated: upgrade to ${fix.targetVersion}`);
      core.info(`[AI] Breaking change: ${fix.isBreakingChange}`);
      core.info(`[AI] Patches: ${fix.patches.map((p) => p.path).join(", ")}`);

      if (!dryRun) {
        const pr = await prCreator.createFixPR(classified, fix);

        core.info(`✅ PR created: ${pr.html_url}`);
        core.setOutput("pr-number", String(pr.number));
        core.setOutput("pr-url", pr.html_url);
      } else {
        core.info("[DRY RUN] Would create PR with the following fix:");
        core.info(JSON.stringify(fix, null, 2));
      }
    }
  } catch (err) {
    core.error(`Failed to process alert #${alert.number}: ${err}`);
    throw err;
  } finally {
    core.endGroup();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  core.info("🚀 dep-resolver-agent starting…");

  const config = loadConfig();
  const ghClient = new GitHubClient(config.githubToken, config.owner, config.repo);
  const classifier = new AlertClassifier(config.thresholds);
  const aiResolver = new AIResolver(config.anthropicApiKey, ghClient);
  const prCreator = new PRCreator(ghClient, config.baseBranch);
  const notifier = new Notifier(
    ghClient,
    config.notificationChannels,
    config.slackWebhookUrl
  );

  // Determine alerts to process
  const targetAlert = await getTargetAlert(ghClient);
  let alerts: DependabotAlert[];

  if (targetAlert === null) {
    // Batch mode
    alerts = await ghClient.listOpenAlerts();
    core.info(`Found ${alerts.length} open Dependabot alert(s).`);
  } else {
    alerts = [targetAlert];
  }

  if (alerts.length === 0) {
    core.info("✅ No open Dependabot alerts. Nothing to do!");
    return;
  }

  // Classify all alerts
  const classified = classifier.classifyAll(alerts);

  // Summary
  const counts = { low: 0, medium: 0, high: 0 };
  for (const c of classified) counts[c.severity]++;
  core.info(
    `Classified: ${counts.low} low, ${counts.medium} medium, ${counts.high} high`
  );

  // Process each alert
  const errors: Error[] = [];
  for (const c of classified) {
    try {
      await processAlert(c, aiResolver, prCreator, notifier, config.dryRun);
    } catch (err) {
      errors.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // Final summary
  core.info("\n📊 Run Summary:");
  core.info(`   Total alerts:   ${classified.length}`);
  core.info(`   Low (auto-PR):  ${counts.low}`);
  core.info(`   Medium (auto-PR): ${counts.medium}`);
  core.info(`   High (notified): ${counts.high}`);
  core.info(`   Errors:         ${errors.length}`);

  if (errors.length > 0) {
    core.setFailed(
      `Completed with ${errors.length} error(s). See logs for details.`
    );
  }
}

// Run only when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    core.setFailed(`Unhandled error: ${err}`);
    process.exit(1);
  });
}
