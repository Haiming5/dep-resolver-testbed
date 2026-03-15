/**
 * Notifier — sends alerts to configured channels for high-severity
 * Dependabot alerts that require human triage.
 *
 * Supported channels:
 *   - "github-issue": Creates a GitHub issue in the same repo
 *   - "slack": Posts to a Slack webhook
 *   - "console": Logs to stdout (useful for debugging / Actions logs)
 */

import * as core from "@actions/core";
import { GitHubClient } from "./github-client";
import type {
  NotificationChannel,
  NotificationPayload,
  ClassifiedAlert,
} from "./types";

export class Notifier {
  private github: GitHubClient;
  private channels: NotificationChannel[];
  private slackWebhookUrl?: string;

  constructor(
    github: GitHubClient,
    channels: NotificationChannel[],
    slackWebhookUrl?: string
  ) {
    this.github = github;
    this.channels = channels;
    this.slackWebhookUrl = slackWebhookUrl;
  }

  /**
   * Send a high-severity alert notification to all configured channels.
   */
  async notify(classified: ClassifiedAlert): Promise<void> {
    const payload = this.buildPayload(classified);

    const results = await Promise.allSettled(
      this.channels.map((ch) => this.sendToChannel(ch, payload))
    );

    for (const [i, result] of results.entries()) {
      if (result.status === "rejected") {
        core.warning(
          `[Notify] Failed to send to ${this.channels[i]}: ${result.reason}`
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private buildPayload(classified: ClassifiedAlert): NotificationPayload {
    const { alert, severity, cvssScore } = classified;
    return {
      alertNumber: alert.number,
      severity,
      packageName: alert.dependency.package.name,
      ecosystem: alert.dependency.package.ecosystem,
      cvssScore,
      summary: alert.security_advisory.summary,
      htmlUrl: alert.html_url,
      cveId: alert.security_advisory.cve_id,
    };
  }

  private async sendToChannel(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<void> {
    switch (channel) {
      case "github-issue":
        return this.sendGitHubIssue(payload);
      case "slack":
        return this.sendSlack(payload);
      case "console":
        return this.sendConsole(payload);
    }
  }

  // -----------------------------------------------------------------------
  // Channel: GitHub Issue
  // -----------------------------------------------------------------------

  private async sendGitHubIssue(payload: NotificationPayload): Promise<void> {
    const title = `🚨 High-Severity Dependabot Alert: ${payload.packageName} (CVSS ${payload.cvssScore})`;

    const body = `## High-Severity Security Alert — Requires Human Triage

| Field | Value |
|-------|-------|
| **Package** | \`${payload.packageName}\` (${payload.ecosystem}) |
| **CVSS Score** | **${payload.cvssScore} / 10** |
| **CVE** | ${payload.cveId ?? "N/A"} |
| **Dependabot Alert** | [#${payload.alertNumber}](${payload.htmlUrl}) |

### Summary
${payload.summary}

### Action Required
This alert has a **HIGH** severity score and was **not** auto-fixed.
Please review the alert and decide on a fix strategy:

1. Review the [Dependabot alert](${payload.htmlUrl}) for full details
2. Determine if a direct version bump is safe or if code changes are needed
3. Create a fix PR manually, or trigger the AI assistant for a draft

---
_Created by dep-resolver-agent_`;

    const issue = await this.github.createIssue({
      title,
      body,
      labels: ["dep-resolver", "security", "high-severity", "needs-triage"],
    });

    core.info(
      `[Notify] Created GitHub issue #${issue.number}: ${issue.html_url}`
    );
  }

  // -----------------------------------------------------------------------
  // Channel: Slack
  // -----------------------------------------------------------------------

  private async sendSlack(payload: NotificationPayload): Promise<void> {
    if (!this.slackWebhookUrl) {
      throw new Error("Slack webhook URL is not configured.");
    }

    const message = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🚨 High-Severity Alert: ${payload.packageName}`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Package:*\n\`${payload.packageName}\`` },
            { type: "mrkdwn", text: `*Ecosystem:*\n${payload.ecosystem}` },
            {
              type: "mrkdwn",
              text: `*CVSS Score:*\n*${payload.cvssScore} / 10*`,
            },
            {
              type: "mrkdwn",
              text: `*CVE:*\n${payload.cveId ?? "N/A"}`,
            },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Summary:*\n${payload.summary}` },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Alert" },
              url: payload.htmlUrl,
              style: "danger",
            },
          ],
        },
      ],
    };

    const response = await fetch(this.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook returned ${response.status}`);
    }

    core.info(`[Notify] Sent Slack notification for alert #${payload.alertNumber}`);
  }

  // -----------------------------------------------------------------------
  // Channel: Console (fallback / CI logs)
  // -----------------------------------------------------------------------

  private sendConsole(payload: NotificationPayload): void {
    core.warning(
      `\n` +
        `╔══════════════════════════════════════════════════════╗\n` +
        `║  🚨 HIGH-SEVERITY DEPENDABOT ALERT                 ║\n` +
        `╠══════════════════════════════════════════════════════╣\n` +
        `║  Package:    ${payload.packageName.padEnd(38)}║\n` +
        `║  Ecosystem:  ${payload.ecosystem.padEnd(38)}║\n` +
        `║  CVSS Score: ${String(payload.cvssScore).padEnd(38)}║\n` +
        `║  CVE:        ${(payload.cveId ?? "N/A").padEnd(38)}║\n` +
        `║  Alert:      #${String(payload.alertNumber).padEnd(37)}║\n` +
        `╠══════════════════════════════════════════════════════╣\n` +
        `║  ${payload.summary.slice(0, 52).padEnd(52)}║\n` +
        `╠══════════════════════════════════════════════════════╣\n` +
        `║  URL: ${payload.htmlUrl.slice(0, 46).padEnd(46)}║\n` +
        `╚══════════════════════════════════════════════════════╝\n`
    );
  }
}
