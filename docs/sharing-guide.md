# Private Sharing Guide

## Overview

Private packages can be shared with specific users, orgs, teams, or tokens using Access Control Lists (ACL).

## Granting Access

```bash
# Via API
POST /v1/shares
{
  "packageId": "<package-id>",
  "principalType": "user|org|team|token",
  "principalId": "<principal-id>",
  "role": "read|write|admin"
}
```

### Roles

| Role | Permissions |
|---|---|
| `read` | Can install and view package |
| `write` | Can publish new versions |
| `admin` | Can manage shares, retract, quarantine |

### Principal Types

| Type | Description |
|---|---|
| `user` | Individual user |
| `org` | Organization (all members) |
| `team` | Team within an organization |
| `token` | API token (for CI) |

## Listing Shares

```bash
GET /v1/packages/:name/shares
```

Returns all ACL entries for a package.

## Revoking Access

```bash
DELETE /v1/shares/:shareId
```

## CI Token Sharing

For CI pipelines, create a token with read access:

```bash
# Create a token via auth API
POST /v1/auth/login
{ "username": "ci-bot", "token": "<dev-admin-token>" }

# Grant the token read access
POST /v1/shares
{
  "packageId": "<package-id>",
  "principalType": "token",
  "principalId": "<token-id>",
  "role": "read"
}
```

Then use the token in CI:

```bash
SAFE_NPM_TOKEN=<ci-token> npm install
```
