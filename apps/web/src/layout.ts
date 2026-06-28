/**
 * HTML layout and error boundary for the web UI (Section 21.1).
 */

export interface LayoutOptions {
  title: string;
  /** Auth token for dev mode. */
  token?: string;
}

/**
 * Render the base HTML layout with header and footer.
 */
export function renderLayout(options: LayoutOptions, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)} — safe-npm</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #222; }
    .header { background: #1a1a2e; color: #fff; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
    .header a { color: #8aff8a; text-decoration: none; }
    .header nav { display: flex; gap: 1rem; }
    .header nav a { color: #ccc; }
    .header nav a:hover { color: #fff; }
    .container { max-width: 1200px; margin: 2rem auto; padding: 0 1rem; }
    .card { background: #fff; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h2 { margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #666; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.85rem; font-weight: 600; }
    .badge-excellent { background: #d4edda; color: #155724; }
    .badge-good { background: #d1ecf1; color: #0c5460; }
    .badge-caution { background: #fff3cd; color: #856404; }
    .badge-danger { background: #f8d7da; color: #721c24; }
    .badge-blocked { background: #721c24; color: #fff; }
    .badge-pending { background: #fff3cd; color: #856404; }
    .badge-approved { background: #d4edda; color: #155724; }
    .badge-rejected { background: #f8d7da; color: #721c24; }
    .badge-private { background: #e2e3e5; color: #383d41; }
    .badge-public { background: #d1ecf1; color: #0c5460; }
    .btn { display: inline-block; padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.9rem; text-decoration: none; }
    .btn-primary { background: #0d6efd; color: #fff; }
    .btn-danger { background: #dc3545; color: #fff; }
    .btn-success { background: #198754; color: #fff; }
    .btn:hover { opacity: 0.9; }
    .error-boundary { background: #f8d7da; color: #721c24; padding: 1rem; border-radius: 8px; margin: 1rem 0; }
    .dev-token { background: #fff3cd; padding: 0.5rem 1rem; border-radius: 4px; margin-bottom: 1rem; font-size: 0.85rem; }
    .panel { margin-bottom: 1.5rem; }
    .panel h3 { margin-bottom: 0.75rem; color: #666; font-size: 1rem; text-transform: uppercase; }
    .findings-list { list-style: none; }
    .findings-list li { padding: 0.5rem; border-left: 3px solid #dc3545; margin-bottom: 0.5rem; background: #f8f9fa; }
    .confirmation-input { margin: 0.5rem 0; padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; width: 100%; }
  </style>
</head>
<body>
  <div class="header">
    <a href="/"><strong>safe-npm</strong></a>
    <nav>
      <a href="/packages">Packages</a>
      <a href="/stage">Staged</a>
      ${options.token ? '<span style="color: #8aff8a;">● authenticated</span>' : '<a href="/login">Login</a>'}
    </nav>
  </div>
  <div class="container">
    ${options.token ? `<div class="dev-token">Dev mode: using auth token</div>` : ''}
    ${content}
  </div>
</body>
</html>`;
}

/**
 * Render an error boundary page.
 */
export function renderError(message: string, statusCode = 500): string {
  return renderLayout({ title: `Error ${statusCode}` }, `
    <div class="error-boundary">
      <h2>Error ${statusCode}</h2>
      <p>${escapeHtml(message)}</p>
      <p><a href="/" class="btn btn-primary">Back to home</a></p>
    </div>
  `);
}

/**
 * Escape HTML to prevent XSS.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
