/**
 * Error model for safe-npm / safe-npx (design todo 2.3).
 *
 * Every security decision is explainable in JSON; errors carry a stable
 * `code`, human `message`, structured `details`, and optional `remediation`.
 */

export const ErrorCode = {
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  TARBALL_INTEGRITY_FAILED: 'TARBALL_INTEGRITY_FAILED',
  POLICY_BLOCKED: 'POLICY_BLOCKED',
  HUMAN_APPROVAL_REQUIRED: 'HUMAN_APPROVAL_REQUIRED',
  AUDIT_REQUIRED: 'AUDIT_REQUIRED',
  SANDBOX_UNAVAILABLE: 'SANDBOX_UNAVAILABLE',
  RETRACTION_NOT_ELIGIBLE: 'RETRACTION_NOT_ELIGIBLE',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ALL_ERROR_CODES: ReadonlyArray<ErrorCode> = Object.values(ErrorCode);

/** HTTP status mapping for API responses. */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  PACKAGE_NOT_FOUND: 404,
  VERSION_NOT_FOUND: 404,
  TARBALL_INTEGRITY_FAILED: 422,
  POLICY_BLOCKED: 403,
  HUMAN_APPROVAL_REQUIRED: 422,
  AUDIT_REQUIRED: 422,
  SANDBOX_UNAVAILABLE: 503,
  RETRACTION_NOT_ELIGIBLE: 409,
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
};

/** CLI exit code mapping (design 6.2). */
export const ERROR_CLI_EXIT_CODE: Record<ErrorCode, number> = {
  PACKAGE_NOT_FOUND: 13,
  VERSION_NOT_FOUND: 13,
  TARBALL_INTEGRITY_FAILED: 11,
  POLICY_BLOCKED: 11,
  HUMAN_APPROVAL_REQUIRED: 10,
  AUDIT_REQUIRED: 12,
  SANDBOX_UNAVAILABLE: 15,
  RETRACTION_NOT_ELIGIBLE: 11,
  AUTH_REQUIRED: 10,
  FORBIDDEN: 11,
  RATE_LIMITED: 11,
};

export interface SafeNpmErrorDetails {
  [key: string]: unknown;
}

export class SafeNpmError extends Error {
  readonly code: ErrorCode;
  readonly details: SafeNpmErrorDetails;
  readonly remediation?: string;

  constructor(
    code: ErrorCode,
    message: string,
    details: SafeNpmErrorDetails = {},
    remediation?: string,
  ) {
    super(message);
    this.name = 'SafeNpmError';
    this.code = code;
    this.details = details;
    this.remediation = remediation;
  }

  toJSON(): {
    code: ErrorCode;
    message: string;
    details: SafeNpmErrorDetails;
    remediation?: string;
  } {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      ...(this.remediation !== undefined ? { remediation: this.remediation } : {}),
    };
  }

  toHttpStatus(): number {
    return ERROR_HTTP_STATUS[this.code];
  }

  toCliExitCode(): number {
    return ERROR_CLI_EXIT_CODE[this.code];
  }
}

export function toHttpStatus(error: SafeNpmError): number {
  return error.toHttpStatus();
}

export function toCliExitCode(error: SafeNpmError): number {
  return error.toCliExitCode();
}
