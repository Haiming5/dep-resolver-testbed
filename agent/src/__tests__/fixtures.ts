import type { DependabotAlert, ClassifiedAlert, AIFixResult } from '../types';

export function makeAlert(cvssScore: number, overrides: Partial<DependabotAlert> = {}): DependabotAlert {
  return {
    number: 1,
    state: 'open',
    dependency: {
      package: { ecosystem: 'npm', name: 'lodash' },
      manifest_path: 'package.json',
      scope: 'runtime',
    },
    security_advisory: {
      ghsa_id: 'GHSA-test-1234-5678',
      cve_id: 'CVE-2024-0001',
      summary: 'Prototype pollution in lodash',
      description: 'A test vulnerability allowing prototype pollution.',
      severity: 'medium',
      cvss: { score: cvssScore, vector_string: null },
      cwes: [],
      identifiers: [],
      references: [],
      published_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      withdrawn_at: null,
    },
    security_vulnerability: {
      package: { ecosystem: 'npm', name: 'lodash' },
      severity: 'medium',
      vulnerable_version_range: '< 4.17.21',
      first_patched_version: { identifier: '4.17.21' },
    },
    url: 'https://api.github.com/repos/test/test/dependabot/alerts/1',
    html_url: 'https://github.com/test/test/security/dependabot/1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    auto_dismissed_at: null,
    ...overrides,
  };
}

export function makeClassified(cvssScore: number): ClassifiedAlert {
  const severity = cvssScore <= 3.9 ? 'low' : cvssScore <= 6.9 ? 'medium' : 'high';
  return { alert: makeAlert(cvssScore), severity, cvssScore };
}

export const SAMPLE_FIX: AIFixResult = {
  summary: 'Upgrade lodash to 4.17.21 to fix prototype pollution.',
  riskAssessment: 'Low risk — patch-level upgrade with no breaking changes.',
  isBreakingChange: false,
  targetVersion: '4.17.21',
  patches: [
    { path: 'package.json', content: '{"dependencies":{"lodash":"^4.17.21"}}' },
  ],
};
