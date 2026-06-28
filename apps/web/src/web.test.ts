import { describe, expect, it } from 'vitest';
import { renderLayout, renderError, escapeHtml } from './layout.js';
import { renderPackageList } from './pages/package-list.js';
import { renderPackageDetail } from './pages/package-detail.js';
import { renderVersionDetail } from './pages/version-detail.js';
import { renderStageList, renderStageDetail } from './pages/stage-detail.js';
import { renderAccessManagement } from './pages/access-management.js';

describe('layout', () => {
  it('renders basic HTML layout', () => {
    const html = renderLayout({ title: 'Test' }, '<p>content</p>');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Test — safe-npm</title>');
    expect(html).toContain('<p>content</p>');
  });

  it('shows authenticated state when token provided', () => {
    const html = renderLayout({ title: 'Test', token: 'abc' }, '');
    expect(html).toContain('authenticated');
    expect(html).toContain('Dev mode');
  });

  it('shows login link when no token', () => {
    const html = renderLayout({ title: 'Test' }, '');
    expect(html).toContain('Login');
  });
});

describe('renderError', () => {
  it('renders error page', () => {
    const html = renderError('Something went wrong', 500);
    expect(html).toContain('Error 500');
    expect(html).toContain('Something went wrong');
  });
});

describe('escapeHtml', () => {
  it('escapes special characters', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

describe('renderPackageList', () => {
  it('renders empty list', () => {
    const html = renderPackageList([]);
    expect(html).toContain('No packages found');
  });

  it('renders packages', () => {
    const html = renderPackageList([
      { name: 'test-pkg', visibility: 'public', latestVersion: '1.0.0', riskScore: 85, riskTier: 'good' },
    ]);
    expect(html).toContain('test-pkg');
    expect(html).toContain('badge-good');
    expect(html).toContain('1.0.0');
  });
});

describe('renderPackageDetail', () => {
  it('renders package with versions', () => {
    const html = renderPackageDetail({
      name: 'test-pkg',
      visibility: 'public',
      description: 'A test package',
      versions: [
        { version: '1.0.0', status: 'public', publishedAt: '2026-01-01', riskScore: 90, riskTier: 'excellent' },
      ],
    });
    expect(html).toContain('test-pkg');
    expect(html).toContain('A test package');
    expect(html).toContain('1.0.0');
    expect(html).toContain('badge-excellent');
  });
});

describe('renderVersionDetail', () => {
  it('renders version with panels', () => {
    const html = renderVersionDetail('test-pkg', {
      version: '1.0.0',
      status: 'public',
      publishedAt: '2026-01-01',
      riskReport: { score: 90 },
      permissions: { fs: 'read' },
    });
    expect(html).toContain('test-pkg');
    expect(html).toContain('1.0.0');
    expect(html).toContain('Risk Report');
    expect(html).toContain('Permissions');
    expect(html).toContain('Audit Report');
    expect(html).toContain('Retraction History');
  });
});

describe('renderStageList', () => {
  it('renders empty list', () => {
    const html = renderStageList([]);
    expect(html).toContain('No staged packages');
  });

  it('renders stages', () => {
    const html = renderStageList([
      { id: 'stage-123', packageId: 'pkg-1', packageVersionId: 'ver-1', status: 'pending', createdAt: '2026-01-01' },
    ]);
    expect(html).toContain('stage-123');
    expect(html).toContain('badge-pending');
    expect(html).toContain('Review');
  });
});

describe('renderStageDetail', () => {
  it('renders pending stage with actions', () => {
    const html = renderStageDetail({
      id: 'stage-1',
      packageId: 'pkg-1',
      packageVersionId: 'ver-1',
      status: 'pending',
      createdAt: '2026-01-01',
      packageName: 'test-pkg',
      version: '1.0.0',
    });
    expect(html).toContain('Review Actions');
    expect(html).toContain('Approve');
    expect(html).toContain('Reject');
  });

  it('renders risky stage with confirmation input', () => {
    const html = renderStageDetail({
      id: 'stage-1',
      packageId: 'pkg-1',
      packageVersionId: 'ver-1',
      status: 'pending',
      createdAt: '2026-01-01',
      packageName: 'test-pkg',
      version: '1.0.0',
      riskFindings: [{ id: 'MALWARE', severity: 'critical', summary: 'Malicious code' }],
    });
    expect(html).toContain('Warning');
    expect(html).toContain('confirmName');
  });

  it('renders non-pending stage without actions', () => {
    const html = renderStageDetail({
      id: 'stage-1',
      packageId: 'pkg-1',
      packageVersionId: 'ver-1',
      status: 'approved',
      createdAt: '2026-01-01',
    });
    expect(html).toContain('Review Complete');
    expect(html).not.toContain('Approve');
  });
});

describe('renderAccessManagement', () => {
  it('renders shares list and forms', () => {
    const html = renderAccessManagement('test-pkg', [
      { id: 'share-1', packageId: 'pkg-1', principalType: 'user', principalId: 'user-1', role: 'read', createdAt: '2026-01-01' },
    ]);
    expect(html).toContain('Access Management');
    expect(html).toContain('share-1');
    expect(html).toContain('Grant New Share');
    expect(html).toContain('Short-lived Token');
  });

  it('renders empty shares', () => {
    const html = renderAccessManagement('test-pkg', []);
    expect(html).toContain('No shares configured');
  });
});
