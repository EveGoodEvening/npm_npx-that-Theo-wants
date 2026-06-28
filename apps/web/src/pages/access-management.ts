/**
 * Access management page (Section 21.4).
 */
import type { ShareRecord } from '../api-client.js';
import { renderLayout, escapeHtml } from '../layout.js';

export function renderAccessManagement(packageName: string, shares: ShareRecord[], token?: string): string {
  const sharesList = shares.length === 0
    ? '<p>No shares configured.</p>'
    : `<table>
      <thead>
        <tr><th>Principal Type</th><th>Principal ID</th><th>Role</th><th>Created</th><th>Actions</th></tr>
      </thead>
      <tbody>
        ${shares.map((s) => `
          <tr>
            <td>${escapeHtml(s.principalType)}</td>
            <td><code>${escapeHtml(s.principalId)}</code></td>
            <td><span class="badge badge-${s.role}">${escapeHtml(s.role)}</span></td>
            <td>${escapeHtml(s.createdAt)}</td>
            <td>
              <form method="POST" action="/packages/${encodeURIComponent(packageName)}/shares/${encodeURIComponent(s.id)}/revoke" style="display: inline;">
                <button type="submit" class="btn btn-danger">Revoke</button>
              </form>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;

  return renderLayout({ title: `Access — ${packageName}`, token }, `
    <div class="card">
      <h2>Access Management: ${escapeHtml(packageName)}</h2>
      <div class="panel">
        <h3>Current Shares</h3>
        ${sharesList}
      </div>
      <div class="panel">
        <h3>Grant New Share</h3>
        <form method="POST" action="/packages/${encodeURIComponent(packageName)}/shares">
          <select name="principalType" class="confirmation-input">
            <option value="user">User</option>
            <option value="org">Org</option>
            <option value="team">Team</option>
            <option value="token">Token</option>
          </select>
          <input type="text" name="principalId" placeholder="Principal ID" class="confirmation-input" required>
          <select name="role" class="confirmation-input">
            <option value="read">Read</option>
            <option value="write">Write</option>
            <option value="admin">Admin</option>
          </select>
          <button type="submit" class="btn btn-primary">Grant</button>
        </form>
      </div>
      <div class="panel">
        <h3>Short-lived Token</h3>
        <form method="POST" action="/packages/${encodeURIComponent(packageName)}/tokens">
          <select name="scope" class="confirmation-input">
            <option value="publish">publish</option>
            <option value="read">read</option>
          </select>
          <input type="number" name="ttlMinutes" placeholder="TTL (minutes)" class="confirmation-input" value="60" min="1" max="1440" required>
          <button type="submit" class="btn btn-primary">Create Token</button>
        </form>
      </div>
    </div>
  `);
}
