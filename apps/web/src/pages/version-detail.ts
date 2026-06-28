/**
 * Version detail page (Section 21.2).
 * Includes risk report, permissions, audit report, and retraction history panels.
 */
import type { VersionDetail } from '../api-client.js';
import { renderLayout, escapeHtml } from '../layout.js';

export function renderVersionDetail(packageName: string, version: VersionDetail, token?: string): string {
  const riskPanel = version.riskReport
    ? `<div class="panel"><h3>Risk Report</h3><pre>${escapeHtml(JSON.stringify(version.riskReport, null, 2))}</pre></div>`
    : '<div class="panel"><h3>Risk Report</h3><p>No risk report available.</p></div>';

  const permissionsPanel = version.permissions
    ? `<div class="panel"><h3>Permissions</h3><pre>${escapeHtml(JSON.stringify(version.permissions, null, 2))}</pre></div>`
    : '<div class="panel"><h3>Permissions</h3><p>No permissions data.</p></div>';

  const auditPanel = version.auditReport
    ? `<div class="panel"><h3>Audit Report</h3><pre>${escapeHtml(JSON.stringify(version.auditReport, null, 2))}</pre></div>`
    : '<div class="panel"><h3>Audit Report</h3><p>No audit report available.</p></div>';

  const retractionPanel = version.retractions && version.retractions.length > 0
    ? `<div class="panel"><h3>Retraction History</h3><ul class="findings-list">${version.retractions.map((r) => `<li>${escapeHtml(JSON.stringify(r))}</li>`).join('')}</ul></div>`
    : '<div class="panel"><h3>Retraction History</h3><p>No retractions.</p></div>';

  return renderLayout({ title: `${packageName} ${version.version}`, token }, `
    <div class="card">
      <h2>${escapeHtml(packageName)} @ ${escapeHtml(version.version)}</h2>
      <p><strong>Status:</strong> <span class="badge badge-${version.status}">${escapeHtml(version.status)}</span></p>
      <p><strong>Published:</strong> ${escapeHtml(version.publishedAt)}</p>
    </div>
    <div class="card">
      ${riskPanel}
      ${permissionsPanel}
      ${auditPanel}
      ${retractionPanel}
    </div>
  `);
}
