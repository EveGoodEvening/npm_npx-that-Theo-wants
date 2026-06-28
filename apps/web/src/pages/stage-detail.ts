/**
 * Stage review pages (Section 21.3).
 */
import type { StageRecord } from '../api-client.js';
import { renderLayout, escapeHtml } from '../layout.js';

/**
 * Render the staged package list.
 */
export function renderStageList(stages: StageRecord[], token?: string): string {
  const rows = stages.length === 0
    ? '<p>No staged packages pending review.</p>'
    : `<table>
      <thead>
        <tr><th>Stage ID</th><th>Status</th><th>Created</th><th>Review</th></tr>
      </thead>
      <tbody>
        ${stages.map((s) => `
          <tr>
            <td><code>${escapeHtml(s.id.slice(0, 8))}</code></td>
            <td><span class="badge badge-${s.status}">${escapeHtml(s.status)}</span></td>
            <td>${escapeHtml(s.createdAt)}</td>
            <td><a href="/stage/${encodeURIComponent(s.id)}" class="btn btn-primary">Review</a></td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  return renderLayout({ title: 'Staged Packages', token }, `
    <div class="card">
      <h2>Staged Packages</h2>
      ${rows}
    </div>
  `);
}

export interface StageDetail extends StageRecord {
  packageName?: string;
  version?: string;
  tarballUrl?: string;
  riskFindings?: Array<{ id: string; severity: string; summary: string }>;
  diffSummary?: Array<{ file: string; status: string }>;
}

/**
 * Render the stage detail page with approve/reject actions.
 */
export function renderStageDetail(stage: StageDetail, token?: string): string {
  const isPending = stage.status === 'pending';
  const isRisky = stage.riskFindings?.some((f) => f.severity === 'high' || f.severity === 'critical');

  const findingsList = stage.riskFindings && stage.riskFindings.length > 0
    ? `<ul class="findings-list">${stage.riskFindings.map((f) => `<li><strong>${escapeHtml(f.id)}</strong> [${escapeHtml(f.severity)}]: ${escapeHtml(f.summary)}</li>`).join('')}</ul>`
    : '<p>No risk findings.</p>';

  const diffList = stage.diffSummary && stage.diffSummary.length > 0
    ? `<table><thead><tr><th>File</th><th>Status</th></tr></thead><tbody>${stage.diffSummary.map((d) => `<tr><td>${escapeHtml(d.file)}</td><td>${escapeHtml(d.status)}</td></tr>`).join('')}</tbody></table>`
    : '<p>No diff summary available.</p>';

  const actions = isPending
    ? `<div class="card">
        <h2>Review Actions</h2>
        ${isRisky ? '<div class="error-boundary"><strong>Warning:</strong> This package has high/critical risk findings. Type the package name to confirm approval.</div>' : ''}
        <form method="POST" action="/stage/${encodeURIComponent(stage.id)}/approve" style="display: inline;">
          ${isRisky ? `<input type="text" name="confirmName" placeholder="Type package name to confirm" class="confirmation-input" required>` : ''}
          <textarea name="reviewNotes" placeholder="Review notes (optional)" class="confirmation-input"></textarea>
          <button type="submit" class="btn btn-success">Approve</button>
        </form>
        <form method="POST" action="/stage/${encodeURIComponent(stage.id)}/reject" style="display: inline; margin-left: 1rem;">
          <textarea name="reviewNotes" placeholder="Reason for rejection" class="confirmation-input"></textarea>
          <button type="submit" class="btn btn-danger">Reject</button>
        </form>
      </div>`
    : `<div class="card"><h2>Review Complete</h2><p>This stage has status: <span class="badge badge-${stage.status}">${escapeHtml(stage.status)}</span></p></div>`;

  return renderLayout({ title: `Stage ${stage.id.slice(0, 8)}`, token }, `
    <div class="card">
      <h2>Stage Review</h2>
      <p><strong>Package:</strong> ${escapeHtml(stage.packageName ?? 'Unknown')}</p>
      <p><strong>Version:</strong> ${escapeHtml(stage.version ?? 'Unknown')}</p>
      <p><strong>Status:</strong> <span class="badge badge-${stage.status}">${escapeHtml(stage.status)}</span></p>
      <p><strong>Created:</strong> ${escapeHtml(stage.createdAt)}</p>
      ${stage.tarballUrl ? `<p><a href="${escapeHtml(stage.tarballUrl)}" class="btn btn-primary">Download tarball</a></p>` : ''}
    </div>
    <div class="card">
      <div class="panel"><h3>Risk Findings</h3>${findingsList}</div>
      <div class="panel"><h3>Diff Summary</h3>${diffList}</div>
    </div>
    ${actions}
  `);
}
