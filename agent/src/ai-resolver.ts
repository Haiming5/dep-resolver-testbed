/**
 * AI Resolver — uses the Anthropic Claude API to analyze a Dependabot
 * vulnerability and generate a fix (version bump + file patches).
 *
 * For each alert it:
 *   1. Reads the manifest file (package.json, requirements.txt, etc.)
 *   2. Reads the lock file if present
 *   3. Sends all context to Claude with a structured prompt
 *   4. Parses Claude's response into an `AIFixResult`
 */

import Anthropic from "@anthropic-ai/sdk";
import * as core from "@actions/core";
import * as fs from "fs";
import * as path from "path";
import { GitHubClient } from "./github-client";
import type { ClassifiedAlert, AIFixResult, Severity } from "./types";

// Map ecosystem → common lock file paths
const LOCK_FILES: Record<string, string[]> = {
  npm: ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
  pip: ["requirements.txt", "Pipfile.lock", "poetry.lock"],
  rubygems: ["Gemfile.lock"],
  nuget: ["packages.lock.json"],
  maven: ["pom.xml"],
  go: ["go.sum"],
  cargo: ["Cargo.lock"],
};

export class AIResolver {
  private anthropic: Anthropic;
  private github: GitHubClient;
  private model = "claude-haiku-4-5-20251001";

  constructor(apiKey: string, github: GitHubClient) {
    this.anthropic = new Anthropic({ apiKey });
    this.github = github;
  }

  /**
   * Analyze an alert and produce an AI-generated fix.
   */
  async resolve(classified: ClassifiedAlert): Promise<AIFixResult> {
    const { alert, severity } = classified;
    const pkg = alert.dependency.package;
    const manifestPath = alert.dependency.manifest_path;

    core.info(
      `[AI] Resolving ${pkg.name} (${pkg.ecosystem}) via ${manifestPath}`
    );

    // 1. Gather context files from the repo
    const context = await this.gatherContext(manifestPath, pkg.ecosystem);

    // 2. Build the prompt
    const prompt = this.buildPrompt(classified, context);

    // 3. Call Claude
    const response = await this.callClaude(prompt, severity);

    // 4. Parse structured response
    return this.parseResponse(response);
  }

  // -----------------------------------------------------------------------
  // Context gathering
  // -----------------------------------------------------------------------

  private async gatherContext(
    manifestPath: string,
    ecosystem: string
  ): Promise<{ manifest: string; lockFile?: string; lockFilePath?: string }> {
    // Read the manifest file
    const manifest = await this.github.getFileContent(manifestPath);

    // Try to find and read a lock file
    const lockCandidates = LOCK_FILES[ecosystem] ?? [];
    const manifestDir = path.dirname(manifestPath);

    for (const lockName of lockCandidates) {
      const lockPath =
        manifestDir === "." ? lockName : `${manifestDir}/${lockName}`;
      try {
        const lockFile = await this.github.getFileContent(lockPath);
        core.info(`[AI] Found lock file: ${lockPath}`);
        return { manifest, lockFile, lockFilePath: lockPath };
      } catch {
        // Lock file not found at this path, try next
      }
    }

    core.info(`[AI] No lock file found for ecosystem "${ecosystem}"`);
    return { manifest };
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  private buildPrompt(
    classified: ClassifiedAlert,
    context: { manifest: string; lockFile?: string; lockFilePath?: string }
  ): string {
    const { alert, severity, cvssScore } = classified;
    const vuln = alert.security_vulnerability;
    const advisory = alert.security_advisory;

    // Load prompt template
    const templatePath = path.resolve(
      __dirname,
      "..",
      "prompts",
      "analyze-vulnerability.md"
    );
    let template: string;
    try {
      template = fs.readFileSync(templatePath, "utf-8");
    } catch {
      // Fallback inline template if file not found (e.g. in dist/)
      template = DEFAULT_PROMPT_TEMPLATE;
    }

    // Interpolate template variables
    return template
      .replace("{{PACKAGE_NAME}}", vuln.package.name)
      .replace("{{ECOSYSTEM}}", vuln.package.ecosystem)
      .replace("{{VULNERABLE_RANGE}}", vuln.vulnerable_version_range)
      .replace(
        "{{PATCHED_VERSION}}",
        vuln.first_patched_version?.identifier ?? "unknown"
      )
      .replace("{{CVSS_SCORE}}", String(cvssScore))
      .replace("{{SEVERITY}}", severity.toUpperCase())
      .replace("{{GHSA_ID}}", advisory.ghsa_id)
      .replace("{{CVE_ID}}", advisory.cve_id ?? "N/A")
      .replace("{{ADVISORY_SUMMARY}}", advisory.summary)
      .replace("{{ADVISORY_DESCRIPTION}}", advisory.description)
      .replace("{{MANIFEST_PATH}}", alert.dependency.manifest_path)
      .replace("{{MANIFEST_CONTENT}}", context.manifest)
      .replace(
        "{{LOCK_FILE_SECTION}}",
        context.lockFile
          ? `## Lock file (${context.lockFilePath})\n\`\`\`\n${context.lockFile.slice(0, 15_000)}\n\`\`\``
          : "_No lock file found._"
      );
  }

  // -----------------------------------------------------------------------
  // Claude API call
  // -----------------------------------------------------------------------

  private async callClaude(prompt: string, severity: Severity): Promise<string> {
    const systemPrompt =
      severity === "low"
        ? SYSTEM_PROMPT_LOW
        : SYSTEM_PROMPT_MEDIUM;

    core.info(`[AI] Sending prompt to Claude (severity=${severity})…`);

    const response = await this.anthropic.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    core.info(`[AI] Received ${text.length} chars from Claude.`);
    return text;
  }

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------

  private parseResponse(raw: string): AIFixResult {
    // We expect Claude to respond with a JSON block inside ```json fences
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)```/);
    if (!jsonMatch) {
      throw new Error(
        "[AI] Claude response did not contain a ```json``` block. " +
          "Raw response:\n" +
          raw.slice(0, 500)
      );
    }

    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      return {
        summary: parsed.summary ?? "No summary provided.",
        riskAssessment: parsed.risk_assessment ?? "No risk assessment.",
        isBreakingChange: parsed.is_breaking_change ?? false,
        targetVersion: parsed.target_version ?? "unknown",
        patches: (parsed.patches ?? []).map((p: any) => ({
          path: p.path,
          content: p.content,
        })),
      };
    } catch (err) {
      throw new Error(
        `[AI] Failed to parse JSON from Claude response: ${err}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_LOW = `You are a dependency security expert. You are analyzing a LOW severity Dependabot alert.

Your task:
1. Analyze the vulnerability and the project's dependency manifest.
2. Determine the safest version to upgrade to (prefer the first patched version).
3. Generate the minimal file changes needed to fix the vulnerability.

Respond ONLY with a JSON block inside \`\`\`json fences with this schema:
{
  "summary": "Brief explanation of the vulnerability and the fix",
  "risk_assessment": "Why this upgrade is low risk",
  "is_breaking_change": false,
  "target_version": "1.2.3",
  "patches": [
    { "path": "package.json", "content": "<full updated file content>" }
  ]
}

Important rules:
- Only change the vulnerable dependency's version. Do NOT modify unrelated dependencies.
- For lock files, do NOT generate lock file content — only update the manifest.
  The CI pipeline will regenerate the lock file.
- If the first patched version is provided, prefer it over the latest version.
- Keep your response concise.`;

const SYSTEM_PROMPT_MEDIUM = `You are a dependency security expert. You are analyzing a MEDIUM severity Dependabot alert.

Your task:
1. Analyze the vulnerability, its potential impact, and the project's dependency manifest.
2. Check for potential breaking changes between the current and patched version.
3. Determine the safest version to upgrade to.
4. Generate the minimal file changes needed to fix the vulnerability.
5. Provide a thorough risk assessment.

Respond ONLY with a JSON block inside \`\`\`json fences with this schema:
{
  "summary": "Brief explanation of the vulnerability and the fix",
  "risk_assessment": "Detailed risk assessment including breaking change analysis",
  "is_breaking_change": true/false,
  "target_version": "1.2.3",
  "patches": [
    { "path": "package.json", "content": "<full updated file content>" }
  ]
}

Important rules:
- Only change the vulnerable dependency's version. Do NOT modify unrelated dependencies.
- For lock files, do NOT generate lock file content — only update the manifest.
- If the first patched version is provided, prefer it over the latest version.
- Flag any semver major version bumps as potential breaking changes.
- Be thorough in your risk assessment — reviewers depend on it.`;

// ---------------------------------------------------------------------------
// Fallback prompt template (used if prompts/ dir not found at runtime)
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT_TEMPLATE = `# Dependabot Vulnerability Analysis

## Package
- **Name:** {{PACKAGE_NAME}}
- **Ecosystem:** {{ECOSYSTEM}}
- **Vulnerable range:** {{VULNERABLE_RANGE}}
- **First patched version:** {{PATCHED_VERSION}}

## Advisory
- **GHSA:** {{GHSA_ID}}
- **CVE:** {{CVE_ID}}
- **CVSS Score:** {{CVSS_SCORE}} ({{SEVERITY}})
- **Summary:** {{ADVISORY_SUMMARY}}

### Description
{{ADVISORY_DESCRIPTION}}

## Manifest file ({{MANIFEST_PATH}})
\`\`\`
{{MANIFEST_CONTENT}}
\`\`\`

{{LOCK_FILE_SECTION}}

---

Please analyze this vulnerability and generate the fix as specified in your system instructions.`;
