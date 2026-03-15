# Generate Pull Request Description

You are writing a PR description for an automated dependency security fix.

## Context
- **Package:** {{PACKAGE_NAME}} ({{ECOSYSTEM}})
- **Alert:** #{{ALERT_NUMBER}}
- **GHSA:** {{GHSA_ID}}
- **CVE:** {{CVE_ID}}
- **CVSS Score:** {{CVSS_SCORE}} ({{SEVERITY}})
- **Vulnerable range:** `{{VULNERABLE_RANGE}}`
- **Upgraded to:** `{{TARGET_VERSION}}`

## Advisory Summary
{{ADVISORY_SUMMARY}}

## Fix Summary
{{FIX_SUMMARY}}

## Risk Assessment
{{RISK_ASSESSMENT}}

---

## Instructions

Write a clear, professional pull request description in Markdown. Include:

1. **What** this PR does (one sentence)
2. **Why** — the vulnerability being fixed, with links to the advisory
3. **Risk level** — whether this is a patch/minor/major bump and potential impact
4. **Testing notes** — what reviewers should check (e.g., "run the test suite", "verify X still works")
5. **Checklist** — a simple review checklist

Keep it concise. Reviewers are busy engineers — respect their time.
