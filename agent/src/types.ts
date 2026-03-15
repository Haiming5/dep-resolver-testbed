/**
 * Type definitions for the Dependabot Auto-Resolver Agent.
 */

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

export type Severity = "low" | "medium" | "high";

export interface SeverityThresholds {
  /** CVSS score upper-bound (inclusive) for "low". Default 3.9 */
  low: number;
  /** CVSS score upper-bound (inclusive) for "medium". Default 6.9 */
  medium: number;
  // Anything above medium threshold is "high"
}

export const DEFAULT_THRESHOLDS: SeverityThresholds = {
  low: 3.9,
  medium: 6.9,
};

// ---------------------------------------------------------------------------
// Dependabot alert (subset of the GitHub API response we care about)
// ---------------------------------------------------------------------------

export interface DependabotAlert {
  number: number;
  state: string;
  dependency: {
    package: {
      ecosystem: string; // e.g. "npm", "pip", "rubygems"
      name: string;
    };
    manifest_path: string; // e.g. "package.json", "requirements.txt"
    scope: string | null; // "development" | "runtime" | null
  };
  security_advisory: {
    ghsa_id: string;
    cve_id: string | null;
    summary: string;
    description: string;
    severity: string; // GitHub's own severity label
    cvss: {
      score: number;
      vector_string: string | null;
    };
    cwes: Array<{ cwe_id: string; name: string }>;
    identifiers: Array<{ type: string; value: string }>;
    references: Array<{ url: string }>;
    published_at: string;
    updated_at: string;
    withdrawn_at: string | null;
  };
  security_vulnerability: {
    package: {
      ecosystem: string;
      name: string;
    };
    severity: string;
    vulnerable_version_range: string;
    first_patched_version: {
      identifier: string;
    } | null;
  };
  url: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  auto_dismissed_at: string | null;
}

// ---------------------------------------------------------------------------
// Classification result
// ---------------------------------------------------------------------------

export interface ClassifiedAlert {
  alert: DependabotAlert;
  severity: Severity;
  cvssScore: number;
}

// ---------------------------------------------------------------------------
// AI-generated fix
// ---------------------------------------------------------------------------

export interface FilePatch {
  /** Path relative to repo root, e.g. "package.json" */
  path: string;
  /** Full new content for the file */
  content: string;
}

export interface AIFixResult {
  /** Human-readable explanation of the fix */
  summary: string;
  /** Risk assessment written by the AI */
  riskAssessment: string;
  /** Whether the AI believes this is a breaking change */
  isBreakingChange: boolean;
  /** The file patches that constitute the fix */
  patches: FilePatch[];
  /** The safe target version to upgrade to */
  targetVersion: string;
}

// ---------------------------------------------------------------------------
// PR creation
// ---------------------------------------------------------------------------

export interface CreatedPR {
  number: number;
  html_url: string;
  branch: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

export type NotificationChannel = "slack" | "github-issue" | "console";

export interface NotificationPayload {
  alertNumber: number;
  severity: Severity;
  packageName: string;
  ecosystem: string;
  cvssScore: number;
  summary: string;
  htmlUrl: string;
  cveId: string | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ResolverConfig {
  /** GitHub token with repo scope */
  githubToken: string;
  /** Anthropic API key */
  anthropicApiKey: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** CVSS severity thresholds */
  thresholds: SeverityThresholds;
  /** Notification channels to use for high-severity alerts */
  notificationChannels: NotificationChannel[];
  /** Optional Slack webhook URL */
  slackWebhookUrl?: string;
  /** Base branch to target PRs against (default: main) */
  baseBranch: string;
  /** Whether to run in dry-run mode (no actual PRs created) */
  dryRun: boolean;
}
