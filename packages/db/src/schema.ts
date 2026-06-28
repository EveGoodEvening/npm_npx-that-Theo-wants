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
    mode: text('mode').notNull().default('basic'),
    status: text('status').notNull().default('queued'),
    costCents: integer('cost_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    result: jsonb('result'),
  },
);

export const auditAttestations = safenpm.table(
  'audit_attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auditJobId: uuid('audit_job_id').notNull().references(() => auditJobs.id),
    packageVersionId: uuid('package_version_id').notNull().references(() => packageVersions.id),
    statementType: text('statement_type').notNull(),
    signedPayload: jsonb('signed_payload').notNull(),
    signature: text('signature').notNull(),
    transparencyLogUrl: text('transparency_log_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
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
