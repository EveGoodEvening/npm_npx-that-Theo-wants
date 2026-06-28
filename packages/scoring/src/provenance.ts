/**
 * Provenance integration (design 12.3).
 *
 * Parses npm provenance metadata, validates it against tarball digest
 * and source repo, and produces a provenance status.
 */

export type ProvenanceStatus = 'verified' | 'missing' | 'mismatch' | 'unsupported';

export interface ProvenanceMetadata {
  /** The provenance envelope (Sigstore bundle). */
  envelope?: unknown;
  /** Subject digest (sha512 of tarball). */
  subjectDigest?: string;
  /** Source repository URL from provenance. */
  sourceRepo?: string;
  /** Source commit hash. */
  sourceCommit?: string;
  /** Builder identity. */
  builder?: string;
}

export interface ProvenanceResult {
  status: ProvenanceStatus;
  sourceRepo?: string;
  sourceCommit?: string;
  builder?: string;
  mismatchReason?: string;
}

/**
 * Parse provenance metadata from a packument version's `_provenance` field.
 */
export function parseProvenance(
  provenanceField: unknown,
): ProvenanceMetadata | null {
  if (!provenanceField || typeof provenanceField !== 'object') return null;

  const obj = provenanceField as Record<string, unknown>;
  // npm provenance format: { url: string, provenance: { ... } }
  if (obj.provenance && typeof obj.provenance === 'object') {
    const inner = obj.provenance as Record<string, unknown>;
    const metadata = inner.metadata as Record<string, unknown> | undefined;
    if (metadata) {
      return {
        envelope: inner,
        subjectDigest: metadata.subjectDigest as string | undefined,
        sourceRepo: (metadata.materials as Array<{ uri: string }>)?.[0]?.uri,
        sourceCommit: metadata.buildStartedOn as string | undefined,
        builder: (inner.builder as { id?: string })?.id,
      };
    }
  }

  return null;
}

/**
 * Validate provenance against the tarball digest and source repo.
 */
export function validateProvenance(
  provenance: ProvenanceMetadata,
  expectedTarballDigest: string,
  expectedSourceRepo?: string,
): ProvenanceResult {
  // Check if provenance has a subject digest.
  if (!provenance.subjectDigest) {
    return {
      status: 'mismatch',
      mismatchReason: 'provenance missing subject digest',
      sourceRepo: provenance.sourceRepo,
      sourceCommit: provenance.sourceCommit,
      builder: provenance.builder,
    };
  }

  // Validate subject digest matches tarball digest.
  if (provenance.subjectDigest !== expectedTarballDigest) {
    return {
      status: 'mismatch',
      mismatchReason: `provenance subject digest (${provenance.subjectDigest}) does not match tarball digest (${expectedTarballDigest})`,
      sourceRepo: provenance.sourceRepo,
      sourceCommit: provenance.sourceCommit,
      builder: provenance.builder,
    };
  }

  // Validate source repo matches package metadata.
  if (expectedSourceRepo && provenance.sourceRepo) {
    if (!reposMatch(provenance.sourceRepo, expectedSourceRepo)) {
      return {
        status: 'mismatch',
        mismatchReason: `provenance source repo (${provenance.sourceRepo}) does not match package metadata (${expectedSourceRepo})`,
        sourceRepo: provenance.sourceRepo,
        sourceCommit: provenance.sourceCommit,
        builder: provenance.builder,
      };
    }
  }

  return {
    status: 'verified',
    sourceRepo: provenance.sourceRepo,
    sourceCommit: provenance.sourceCommit,
    builder: provenance.builder,
  };
}

/**
 * Check if two repo URLs refer to the same repository.
 */
function reposMatch(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/^git\+/, '').replace(/^https:\/\/|^ssh:\/\/git@/, '').replace(/\.git$/, '').replace(/\/$/, '').toLowerCase();
  return normalize(url1) === normalize(url2);
}

/**
 * Compute a provenance score bonus.
 * Verified provenance gets +10, missing gets 0, mismatch gets -20.
 */
export function provenanceScoreBonus(status: ProvenanceStatus): number {
  switch (status) {
    case 'verified': return 10;
    case 'missing': return 0;
    case 'mismatch': return -20;
    case 'unsupported': return 0;
  }
}
