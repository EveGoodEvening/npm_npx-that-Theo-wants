# Security Documentation

## Threat Model

### Threats and Mitigations

| Threat | Mitigation |
|---|---|
| Maintainer account takeover | Passkeys/2FA, trusted publishing, staged approval, maintainer drift scoring |
| Malicious new package | Typosquat detection, low-history scoring, install-time risk card, public-promotion review |
| Malicious update to trusted package | Diff analysis, maintainer drift detection, paid audits, staged public release |
| Install script exfiltration | Deny-by-default in strict/agent modes, static analysis, explicit allowlist, sandbox |
| npx one-off execution compromise | Preflight before fetch/exec, exact version pinning, risk report, policy engine |
| Republish cache poisoning | Publish IDs, immutable object keys, lockfile-safe tarball URLs |
| Typosquatting | Name similarity detection, name corpus comparison, risk score penalty |
| Supply chain attack via dependencies | Transitive dependency analysis, OSV integration, policy enforcement |

## Sandbox Limitations

### Current Limitations

- **Static analysis only**: The analyzer inspects code without executing it. This means:
  - Dynamic behavior (e.g., runtime-evaluated payloads) may not be detected.
  - Obfuscated code may evade pattern matching.
  - Native addons cannot be fully analyzed.

- **No runtime sandbox**: The current implementation does not sandbox execution. Future work:
  - `safe-npx` should execute in a restricted environment (no network, restricted filesystem).
  - Use `bwrap` or similar for Linux, `sandbox-exec` for macOS.

- **Permission enforcement**: The policy engine can require permission enforcement, but the current CLI does not enforce OS-level permissions. This is a future enhancement.

### What the Analyzer Does

- Extracts tarball to a quarantine cache (never in the project directory).
- Parses JavaScript AST to detect dangerous patterns.
- Inspects package.json for metadata and scripts.
- Checks for native artifacts (binding.gyp, .node files).
- Compares against known vulnerability databases (OSV).

## Install Count Privacy

- Install counts are approximate due to caching and mirroring.
- Counts are used for retraction eligibility, not for precise analytics.
- The threshold (300 downloads/week) is designed to limit blast radius, not produce legal-grade metrics.
- Individual install events are logged but not attributed to specific users in analytics.

## Semver Reuse and Lockfile Safety

### Problem

npm allows version reuse: the same `name@version` can be republished after unpublish. This breaks lockfile integrity because the same URL could serve different content.

### Solution

- **Publish IDs**: Each publish gets a unique publish ID.
- **Immutable object keys**: Tarballs are stored content-addressed by SHA-512 digest.
- **Lockfile-safe URLs**: Tarball URLs include the publish ID, so old lockfiles always point to the original content.
- **Version immutability**: Once a version is published, the `name@version` tuple is immutable. Republishing creates a new publish ID and new tarball URL.

### Retention

- Old tarball URLs are preserved during the retention period.
- Even after retraction, tarballs remain accessible for lockfile safety (unless quarantined).

## False Positive Override Process

### When a False Positive Occurs

1. **Identify**: The risk card shows a finding that is not actually malicious.
2. **Document**: Record the finding and why it's a false positive.
3. **Override**: Use policy overrides to allow the package despite the finding.

### Policy Overrides

```json
{
  "overrides": [
    {
      "package": "my-package",
      "version": "1.0.0",
      "rule": "install.allowInstallScripts",
      "reason": "Postinstall script is safe (only logs a message)",
      "expiresAt": "2025-12-31T00:00:00Z"
    }
  ]
}
```

### Audit Trail

All overrides are audit logged with:
- Actor (who applied the override)
- Reason
- Expiration
- Package and version

### Review

Overrides should be reviewed periodically:
- Expired overrides are automatically removed.
- Long-lived overrides should be reviewed for continued necessity.
- Overrides for high-risk findings (e.g., child_process usage) should require admin approval.
