/**
 * Severity classifier for Dependabot alerts.
 *
 * Maps the CVSS score from the security advisory to our three-tier model:
 *   Low:    0   – 3.9
 *   Medium: 4.0 – 6.9
 *   High:   7.0 – 10.0
 *
 * The thresholds are configurable via `SeverityThresholds`.
 */

import * as core from "@actions/core";
import type {
  DependabotAlert,
  ClassifiedAlert,
  Severity,
  SeverityThresholds,
} from "./types";
import { DEFAULT_THRESHOLDS } from "./types";

export class AlertClassifier {
  private thresholds: SeverityThresholds;

  constructor(thresholds: SeverityThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
  }

  /**
   * Classify a single Dependabot alert.
   */
  classify(alert: DependabotAlert): ClassifiedAlert {
    const cvssScore = alert.security_advisory.cvss.score;
    const severity = this.scoreToSeverity(cvssScore);

    core.info(
      `Alert #${alert.number} (${alert.dependency.package.name}): ` +
        `CVSS ${cvssScore} → ${severity.toUpperCase()}`
    );

    return { alert, severity, cvssScore };
  }

  /**
   * Classify a batch of alerts.
   */
  classifyAll(alerts: DependabotAlert[]): ClassifiedAlert[] {
    return alerts.map((a) => this.classify(a));
  }

  /**
   * Map a numeric CVSS score to a severity tier.
   */
  private scoreToSeverity(score: number): Severity {
    if (score <= this.thresholds.low) return "low";
    if (score <= this.thresholds.medium) return "medium";
    return "high";
  }
}
