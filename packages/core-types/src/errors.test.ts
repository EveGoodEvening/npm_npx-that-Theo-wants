import { describe, expect, it } from 'vitest';
import {
  ALL_ERROR_CODES,
  ErrorCode,
  ERROR_CLI_EXIT_CODE,
  ERROR_HTTP_STATUS,
  SafeNpmError,
  toCliExitCode,
  toHttpStatus,
} from '../src/index.js';

describe('SafeNpmError', () => {
  it('includes code, message, details, and remediation', () => {
    const err = new SafeNpmError(
      ErrorCode.POLICY_BLOCKED,
      'install scripts not allowed',
      { policy: 'strict' },
      'approve the package version explicitly',
    );
    expect(err.code).toBe('POLICY_BLOCKED');
    expect(err.details.policy).toBe('strict');
    expect(err.remediation).toBe('approve the package version explicitly');
  });

  it('serializes to JSON with optional remediation omitted when absent', () => {
    const err = new SafeNpmError(ErrorCode.AUTH_REQUIRED, 'token required');
    const json = err.toJSON();
    expect(json.code).toBe('AUTH_REQUIRED');
    expect(json.remediation).toBeUndefined();
    expect(JSON.parse(JSON.stringify(json)).code).toBe('AUTH_REQUIRED');
  });

  it('every error code has an HTTP status and CLI exit code', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(ERROR_HTTP_STATUS[code]).toBeTypeOf('number');
      expect(ERROR_CLI_EXIT_CODE[code]).toBeTypeOf('number');
    }
  });

  it('toHttpStatus and toCliExitCode map correctly', () => {
    const notFound = new SafeNpmError(ErrorCode.PACKAGE_NOT_FOUND, 'missing');
    expect(toHttpStatus(notFound)).toBe(404);
    expect(toCliExitCode(notFound)).toBe(13);

    const sandbox = new SafeNpmError(ErrorCode.SANDBOX_UNAVAILABLE, 'no sandbox');
    expect(toHttpStatus(sandbox)).toBe(503);
    expect(toCliExitCode(sandbox)).toBe(15);
  });
});
