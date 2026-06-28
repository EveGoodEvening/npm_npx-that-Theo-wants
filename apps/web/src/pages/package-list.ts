/**
 * Package list page (Section 21.2).
 */
import type { PackageSummary } from '../api-client.js';
import { renderLayout, escapeHtml } from '../layout.js';

export function renderPackageList(packages: PackageSummary[], token?: string): string {
  const rows = packages.length === 0
    ? '<p>No packages found.</p>'
    : `<table>
      <thead>
        <tr><th>Name</th><th>Visibility</th><th>Latest</th><th>Risk</th></tr>
      </thead>
      <tbody>
        ${packages.map((p) => `
          <tr>
            <td><a href="/packages/${encodeURIComponent(p.name)}">${escapeHtml(p.name)}</a></td>
            <td><span class="badge badge-${p.visibility}">${escapeHtml(p.visibility)}</span></td>
            <td>${escapeHtml(p.latestVersion ?? '—')}</td>
            <td>${p.riskTier ? `<span class="badge badge-${p.riskTier}">${escapeHtml(p.riskTier)}</span> ${p.riskScore ?? '—'}` : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  return renderLayout({ title: 'Packages', token }, `
    <div class="card">
      <h2>Packages</h2>
      ${rows}
    </div>
  `);
}
