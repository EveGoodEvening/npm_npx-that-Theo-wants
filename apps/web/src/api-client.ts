/**
 * API client for the safe-npm registry (Section 21.1).
 *
 * Minimal client for the web UI to communicate with the registry API.
 */
export interface ApiClientOptions {
  baseUrl: string;
  /** Auth token (dev only — real auth uses OIDC/passkey). */
  token?: string;
}

export interface PackageSummary {
  name: string;
  visibility: string;
  latestVersion?: string;
  riskScore?: number;
  riskTier?: string;
}

export interface PackageDetail extends PackageSummary {
  description?: string;
  versions: Array<{
    version: string;
    status: string;
    publishedAt: string;
    riskScore?: number;
    riskTier?: string;
  }>;
}

export interface VersionDetail {
  version: string;
  status: string;
  publishedAt: string;
  riskReport?: unknown;
  permissions?: unknown;
  auditReport?: unknown;
  retractions?: unknown[];
}

export interface StageRecord {
  id: string;
  packageId: string;
  packageVersionId: string;
  status: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  rejectedBy?: string;
  rejectedAt?: string;
  reviewNotes?: string;
}

export interface ShareRecord {
  id: string;
  packageId: string;
  principalType: string;
  principalId: string;
  role: string;
  createdAt: string;
}

export class ApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) h.authorization = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json() as T;
    if (!resp.ok) {
      throw new ApiError(`API error: ${resp.status}`, resp.status, data);
    }
    return data;
  }

  /** List packages. */
  async listPackages(): Promise<PackageSummary[]> {
    const data = await this.request<{ packages: PackageSummary[] }>('GET', '/v1/packages');
    return data.packages ?? [];
  }

  /** Get package detail. */
  async getPackage(name: string): Promise<PackageDetail> {
    return this.request<PackageDetail>('GET', `/${encodeURIComponent(name).replace('%40', '@')}`);
  }

  /** Get version detail. */
  async getVersion(name: string, version: string): Promise<VersionDetail> {
    return this.request<VersionDetail>('GET', `/v1/packages/${encodeURIComponent(name).replace('%40', '@')}/versions/${version}`);
  }

  /** List staged packages. */
  async listStaged(): Promise<StageRecord[]> {
    const data = await this.request<{ stages: StageRecord[] }>('GET', '/v1/stage');
    return data.stages ?? [];
  }

  /** Approve a stage. */
  async approveStage(stageId: string, reviewNotes?: string): Promise<void> {
    await this.request('POST', `/v1/stage/${stageId}/approve`, { reviewNotes });
  }

  /** Reject a stage. */
  async rejectStage(stageId: string, reviewNotes?: string): Promise<void> {
    await this.request('POST', `/v1/stage/${stageId}/reject`, { reviewNotes });
  }

  /** List shares for a package. */
  async listShares(packageName: string): Promise<ShareRecord[]> {
    const data = await this.request<{ shares: ShareRecord[] }>('GET', `/v1/packages/${encodeURIComponent(packageName).replace('%40', '@')}/shares`);
    return data.shares ?? [];
  }

  /** Grant a share. */
  async grantShare(packageId: string, principalType: string, principalId: string, role: string): Promise<void> {
    await this.request('POST', '/v1/shares', { packageId, principalType, principalId, role });
  }

  /** Revoke a share. */
  async revokeShare(shareId: string): Promise<void> {
    await this.request('DELETE', `/v1/shares/${shareId}`);
  }
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly data: unknown;
  constructor(message: string, statusCode: number, data: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.data = data;
  }
}
