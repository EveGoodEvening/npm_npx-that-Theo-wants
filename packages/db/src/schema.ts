/**
 * Drizzle ORM schema for the safe-npm registry.
 *
 * Mirrors the data model in plan/design.md Section 7. Uses PostgreSQL as the
 * source of truth; tarballs and analysis artifacts live in object storage.
 */
import {
  pgSchema,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
  primaryKey,
  index,
  serial,
  pgEnum,
} from 'drizzle-orm/pg-core';

// Use a dedicated schema to avoid collisions with other tools.
export const safenpm = pgSchema('safenpm');

// --- Enums ---

export const packageVisibility = pgEnum('package_visibility', [
  'private',
  'public',
  'quarantined',
]);

export const versionStatus = pgEnum('version_status', [
  'private',
  'staged_public',
  'public',
  'retracted',
  'deprecated',
  'quarantined',
  'deleted',
]);

export const riskTier = pgEnum('risk_tier', [
  'excellent',
  'good',
  'caution',
  'danger',
  'blocked',
]);

export const retractionMode = pgEnum('retraction_mode', [
  'threshold_retract',
  'admin_quarantine',
  'policy_yank',
]);

export const installEventType = pgEnum('install_event_type', [
  'manifest_resolve',
  'tarball_fetch',
  'exec_preflight',
  'install_success',
]);

export const auditJobMode = pgEnum('audit_job_mode', [
  'basic',
  'paid',
  'byo_advisory',
]);

export const auditJobStatus = pgEnum('audit_job_status', [
  'queued',
  'running',
  'passed',
  'warned',
  'failed',
  'errored',
  'cancelled',
]);

export const policyScopeType = pgEnum('policy_scope_type', [
  'user',
  'org',
  'project',
  'ci',
  'agent',
]);

// --- Core entities (design 7.1) ---

export const users = safenpm.table(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: text('username').unique().notNull(),
    email: text('email').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    passkeyEnabled: boolean('passkey_enabled').notNull().default(false),
    riskFlags: jsonb('risk_flags').notNull().default({}),
  },
);

export const orgs = safenpm.table(
  'orgs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').unique().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    defaultVisibility: text('default_visibility').notNull().default('private'),
    policyId: uuid('policy_id'),
  },
);

export const memberships = safenpm.table(
  'memberships',
  {
    orgId: uuid('org_id').notNull().references(() => orgs.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

export const packages = safenpm.table(
  'packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').unique().notNull(),
    scope: text('scope'),
    ownerOrgId: uuid('owner_org_id').references(() => orgs.id),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    visibility: text('visibility').notNull().default('private'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    nameRisk: jsonb('name_risk').notNull().default({}),
  },
  (t) => [
    index('packages_scope_idx').on(t.scope),
    index('packages_owner_org_idx').on(t.ownerOrgId),
    index('packages_owner_user_idx').on(t.ownerUserId),
  ],
);

export const packageVersions = safenpm.table(
  'package_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id').notNull().references(() => packages.id),
    version: text('version').notNull(),
    publishId: uuid('publish_id').notNull(),
    status: text('status').notNull().default('private'),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    publisherUserId: uuid('publisher_user_id').references(() => users.id),
    tarballObjectKey: text('tarball_object_key').notNull(),
    tarballSha512: text('tarball_sha512').notNull(),
    tarballShasum: text('tarball_shasum'),
    unpackedSizeBytes: bigint('unpacked_size_bytes', { mode: 'number' }),
    fileCount: integer('file_count'),
    provenanceStatus: text('provenance_status'),
    sourceRepositoryUrl: text('source_repository_url'),
    sourceCommitSha: text('source_commit_sha'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (t) => [
    index('pv_package_idx').on(t.packageId),
    index('pv_publish_id_idx').on(t.publishId),
    index('pv_status_idx').on(t.status),
  ],
);

export const versionAliases = safenpm.table(
  'version_aliases',
  {
    packageId: uuid('package_id').notNull().references(() => packages.id),
    version: text('version').notNull(),
    activePublishId: uuid('active_publish_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.packageId, t.version] })],
);

export const distTags = safenpm.table(
  'dist_tags',
  {
    packageId: uuid('package_id').notNull().references(() => packages.id),
    tag: text('tag').notNull(),
    version: text('version').notNull(),
    publishId: uuid('publish_id').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.packageId, t.tag] })],
);

// --- Retraction/unpublish entities (design 7.2) ---

export const versionRetractions = safenpm.table(
  'version_retractions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    reason: text('reason').notNull(),
    mode: text('mode').notNull(),
    observedInstallsAtRetract: integer('observed_installs_at_retract').notNull().default(0),
    ageSecondsAtRetract: integer('age_seconds_at_retract').notNull().default(0),
    semverReuseAllowed: boolean('semver_reuse_allowed').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const installEvents = safenpm.table(
  'install_events',
  {
    id: serial('id').primaryKey(),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    eventType: text('event_type').notNull(),
    privacyBucket: text('privacy_bucket').notNull(),
    userAgentHash: text('user_agent_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ie_version_idx').on(t.packageVersionId),
    index('ie_created_idx').on(t.createdAt),
  ],
);

export const installRollups = safenpm.table(
  'install_rollups',
  {
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    uniqueInstallCount: integer('unique_install_count').notNull().default(0),
    tarballFetchCount: integer('tarball_fetch_count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.packageVersionId, t.windowStart, t.windowEnd] })],
);

// --- Risk and audit entities (design 7.3) ---

export const riskReports = safenpm.table(
  'risk_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    score: integer('score').notNull(),
    tier: text('tier').notNull(),
    confidence: integer('confidence').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    analyzerVersion: text('analyzer_version').notNull(),
    evidenceDigest: text('evidence_digest').notNull(),
    report: jsonb('report').notNull(),
  },
  (t) => [
    index('rr_version_idx').on(t.packageVersionId),
    index('rr_digest_idx').on(t.evidenceDigest),
  ],
);

export const auditJobs = safenpm.table(
  'audit_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    requesterUserId: uuid('requester_user_id').references(() => users.id),
    providerId: uuid('provider_id'),
    provider: text('provider'),
    mode: text('mode').notNull().default('basic'),
    status: text('status').notNull().default('queued'),
    idempotencyKey: text('idempotency_key'),
    tarballDigest: text('tarball_digest'),
    evidenceBundle: jsonb('evidence_bundle'),
    providerJobId: text('provider_job_id'),
    error: text('error'),
    costCents: integer('cost_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    result: jsonb('result'),
  },
  (t) => [
    index('aj_version_idx').on(t.packageVersionId),
    index('aj_status_idx').on(t.status),
    index('aj_idem_idx').on(t.idempotencyKey),
  ],
);

export const auditAttestations = safenpm.table(
  'audit_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditJobId: uuid('audit_job_id').notNull().references(() => auditJobs.id),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    tarballDigest: text('tarball_digest'),
    provider: text('provider'),
    providerVersion: text('provider_version'),
    judgment: text('judgment'),
    scoreAdjustment: integer('score_adjustment').default(0),
    findings: jsonb('findings').default([]),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    statementType: text('statement_type').notNull(),
    signedPayload: jsonb('signed_payload').notNull(),
    signature: text('signature').notNull(),
    publicKeyId: text('public_key_id'),
    transparencyLogUrl: text('transparency_log_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('aa_version_idx').on(t.packageVersionId),
    index('aa_digest_idx').on(t.tarballDigest),
    index('aa_job_idx').on(t.auditJobId),
  ],
);

// --- Permission entities (design 7.4) ---

export const permissionReports = safenpm.table(
  'permission_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    declaredPermissions: jsonb('declared_permissions').notNull().default({}),
    inferredPermissions: jsonb('inferred_permissions').notNull().default({}),
    enforceability: jsonb('enforceability').notNull().default({}),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export const policySets = safenpm.table(
  'policy_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scopeType: text('scope_type').notNull(),
    scopeId: text('scope_id').notNull(),
    policy: jsonb('policy').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ps_scope_idx').on(t.scopeType, t.scopeId),
  ],
);

// --- Auth tokens (Section 7.4) ---

export const authTokens = safenpm.table(
  'auth_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tokenHash: text('token_hash').unique().notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    label: text('label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Strong auth marker (design 16.1). Set when user completes WebAuthn/passkey. */
    strongAuthAt: timestamp('strong_auth_at', { withTimezone: true }),
    /** Token owner org (design 16.2). */
    ownerOrgId: uuid('owner_org_id').references(() => orgs.id),
    /** Package allowlist (design 16.2). */
    packageAllowlist: jsonb('package_allowlist').notNull().default([]),
    /** Command allowlist (design 16.2). */
    commandAllowlist: jsonb('command_allowlist').notNull().default([]),
    /** Revocation timestamp (design 16.2). */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('at_user_idx').on(t.userId),
    index('at_token_hash_idx').on(t.tokenHash),
  ],
);

// --- Stage records (Section 15.1) ---

export const stageStatus = pgEnum('stage_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
]);

export const stageRecords = safenpm.table(
  'stage_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id').notNull().references(() => packages.id),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    createdBy: uuid('created_by').references(() => users.id),
    status: stageStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedBy: uuid('rejected_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
  },
  (t) => [
    index('sr_package_idx').on(t.packageId),
    index('sr_version_idx').on(t.packageVersionId),
    index('sr_status_idx').on(t.status),
  ],
);

// --- Trusted publishers (Section 16.3) ---

export const trustedPublishers = safenpm.table(
  'trusted_publishers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id').references(() => packages.id),
    provider: text('provider').notNull(),
    repository: text('repository').notNull(),
    workflow: text('workflow'),
    environment: text('environment'),
    allowedActions: jsonb('allowed_actions').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tp_package_idx').on(t.packageId),
    index('tp_provider_repo_idx').on(t.provider, t.repository),
  ],
);

// --- Package ACL (Section 17.1) ---

export const packageAclRole = pgEnum('package_acl_role', [
  'read',
  'write',
  'admin',
]);

export const packageAclPrincipalType = pgEnum('package_acl_principal_type', [
  'user',
  'org',
  'team',
  'token',
]);

export const packageAcl = safenpm.table(
  'package_acl',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id').notNull().references(() => packages.id),
    principalType: packageAclPrincipalType('principal_type').notNull(),
    principalId: uuid('principal_id').notNull(), // user_id, org_id, or token_id
    role: packageAclRole('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    index('pa_package_idx').on(t.packageId),
    index('pa_principal_idx').on(t.principalType, t.principalId),
  ],
);

// --- Payment ledger (Section 20.4) ---

export const billingAccounts = safenpm.table(
  'billing_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    creditBalance: integer('credit_balance').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ba_user_idx').on(t.userId),
  ],
);

export const ledgerEntryType = pgEnum('ledger_entry_type', [
  'credit',
  'debit',
  'refund',
  'reserve',
  'capture',
]);

export const ledgerEntries = safenpm.table(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => billingAccounts.id),
    auditJobId: uuid('audit_job_id').references(() => auditJobs.id),
    type: ledgerEntryType('type').notNull(),
    amount: integer('amount').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('le_account_idx').on(t.accountId),
    index('le_idem_idx').on(t.idempotencyKey),
  ],
);

// --- 25.1: Audit logs ---

export const auditLogAction = pgEnum('audit_log_action', [
  'publish',
  'stage_create',
  'stage_approve',
  'stage_reject',
  'retract',
  'deprecate',
  'share_change',
  'token_create',
  'token_revoke',
  'token_use',
  'policy_change',
  'admin_quarantine',
  'admin_unquarantine',
  'name_dispute',
  'name_dispute_resolve',
  'paid_audit_request',
  'paid_audit_result',
]);

export const auditLogs = safenpm.table(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: auditLogAction('action').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    actorScopes: text('actor_scopes'),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    packageId: uuid('package_id').references(() => packages.id),
    versionId: uuid('version_id').references(() => packageVersions.id),
    detail: jsonb('detail'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('al_action_idx').on(t.action),
    index('al_actor_idx').on(t.actorUserId),
    index('al_target_idx').on(t.targetType, t.targetId),
    index('al_created_idx').on(t.createdAt),
  ],
);
