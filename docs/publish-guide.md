# safe-npm publish Guide

## Private-First Publishing

All packages start private. This prevents accidental public release of unreviewed code.

## Basic Publish

```bash
# Publish to private registry (default)
safe-npm publish

# Publish with explicit private access
safe-npm publish --access private

# Publish to a specific registry
safe-npm publish --registry https://registry.my-org.com
```

## What Happens During Publish

1. **Pack**: The package is packed into a tarball (like `npm pack`).
2. **Upload**: The tarball is uploaded to the registry.
3. **Analysis**: The registry runs static analysis on the tarball.
4. **Scoring**: A risk report is generated with a score and tier.
5. **Storage**: The tarball is stored content-addressed (SHA-512).

## Public Promotion

To make a private package public:

1. **Create a stage record**:
   ```bash
   # Via API
   POST /v1/stage
   { "packageId": "<id>", "packageVersionId": "<id>" }
   ```

2. **Admin review**: An admin reviews the risk report and stage record.

3. **Approve or reject**:
   ```bash
   # Approve
   POST /v1/stage/<stageId>/approve
   { "reviewNotes": "Reviewed, looks good" }

   # Reject
   POST /v1/stage/<stageId>/reject
   { "reviewNotes": "Needs security review" }
   ```

4. **Public**: On approval, the version status changes to `public` and the package is visible to unauthenticated users.

## Retraction

If a published version has issues, you can retract it:

```bash
safe-npm retract my-package@1.0.0 --reason "security issue"
```

### Eligibility

Retraction is eligible when:
- The version is less than 72 hours old, OR
- The version has fewer than 300 installs in the last week, AND
- There are no dependents in the public registry

Use `--force` to bypass eligibility (admin only).
