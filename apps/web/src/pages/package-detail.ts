/**
 * Package detail page (Section 21.2).
 */
import type { PackageDetail } from '../api-client.js';
import { renderLayout, escapeHtml } from '../layout.js';

export function renderPackageDetail(pkg: PackageDetail, token?: string): string {
  const versions = pkg.versions.length === 0
    ? '<p>No versions published.</p>'
    : `<table>
      <thead>
        <tr><th>Version</th><th>Status</th><th>Published</th><th>Risk</th></tr>
      </thead>
      <tbody>
        ${pkg.versions.map((v) => `
          <tr>
            <td><a href="/packages/${encodeURIComponent(pkg.name)}/versions/${encodeURIComponent(v.version)}">${escapeHtml(v.version)}</a></td>
            <td><span class="badge badge-${v.status}">${escapeHtml(v.status)}</span></td>
            <td>${escapeHtml(v.publishedAt)}</td>
            <td>${v.riskTier ? `<span class="badge badge-${v.riskTier}">${escapeHtml(v.riskTier)}</span> ${v.riskScore ?? '—'}` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  return renderLayout({ title: pkg.name, token }, `
    <div class="card">
      <h2>${escapeHtml(pkg.name)}</h2>
      <p><strong>Visibility:</strong> <span class="badge badge-${pkg.visibility}">${escapeHtml(pkg.visibility)}</span></p>
      ${pkg.description ? `<p><strong>Description:</strong> ${escapeHtml(pkg.description)}</p>` : ''}
    </div>
    <div class="card">
      <h2>Versions</h2>
      ${versions}
    </div>
  `);
}
