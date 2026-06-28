# Paid Audit Guide

## Overview

You can request a paid third-party security audit for any package version. The audit produces a signed attestation that can be verified by clients.

## Requesting an Audit

```bash
# Via CLI
safe-npm audit request my-package@1.0.0 --provider mock

# Via API
POST /v1/audits
{
  "package": "my-package",
  "version": "1.0.0",
  "provider": "mock",
  "idempotencyKey": "unique-key-123"
}
```

### Response

```json
{
  "auditId": "<audit-job-id>",
  "status": "pending",
  "cost": 500
}
```

The cost is in cents (500 = $5.00).

## Checking Audit Status

```bash
# Via CLI
safe-npm audit status <auditId>

# Via API
GET /v1/audits/<auditId>
```

### Status Values

| Status | Description |
|---|---|
| `pending` | Audit job queued, waiting for worker |
| `running` | Audit provider is processing |
| `completed` | Audit finished, attestation available |
| `failed` | Audit failed |
| `cancelled` | Audit was cancelled |

## Retrieving Attestations

```bash
GET /v1/audit-attestations/<tarball-digest>
```

Returns the signed attestation for the package version.

### Attestation Format

```json
{
  "attestationId": "<id>",
  "auditJobId": "<job-id>",
  "provider": "mock",
  "tarballDigest": "sha512-...",
  "verdict": "clean|suspicious|malicious",
  "score": 95,
  "signature": "...",
  "publicKeyId": "...",
  "createdAt": "2024-..."
}
```

## Billing

Audits are billed to the requesting user's billing account:

- Credits are reserved when the audit is requested.
- Credits are captured when the audit completes.
- Credits are refunded if the audit fails or is cancelled.

## Providers

| Provider | Description |
|---|---|
| `mock` | Mock provider for testing (free) |
| `socket` | Socket.dev audit (future) |
| `snyk` | Snyk audit (future) |
| `trailofbits` | Trail of Bits audit (future) |
