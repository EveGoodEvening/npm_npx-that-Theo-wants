/**
 * Web UI server (Section 21.1).
 *
 * Minimal Fastify server that serves HTML pages for the web UI.
 */
import type { FastifyInstance } from 'fastify';
import cookiePlugin from '@fastify/cookie';
import { ApiClient } from './api-client.js';
import { renderLayout, renderError, escapeHtml } from './layout.js';
import { renderPackageList } from './pages/package-list.js';
import { renderPackageDetail } from './pages/package-detail.js';
import { renderVersionDetail } from './pages/version-detail.js';
import { renderStageList, renderStageDetail } from './pages/stage-detail.js';
import { renderAccessManagement } from './pages/access-management.js';

export interface WebServerOptions {
  apiBaseUrl: string;
  /** Dev auth token (in production, use OIDC/passkey). */
  devToken?: string;
}

export async function registerWebRoutes(
  app: FastifyInstance,
  options: WebServerOptions,
): Promise<void> {
  // Register cookie plugin for dev token handling.
  await app.register(cookiePlugin);

  const api = new ApiClient({
    baseUrl: options.apiBaseUrl,
    token: options.devToken,
  });

  // Dev login page (token input).
  app.get('/login', async (_request, reply) => {
    reply.type('text/html');
    return renderLayout({ title: 'Login' }, `
      <div class="card">
        <h2>Login</h2>
        <p>Dev mode: enter an auth token to access the registry.</p>
        <form method="POST" action="/login">
          <input type="password" name="token" placeholder="Auth token" class="confirmation-input" required>
          <button type="submit" class="btn btn-primary">Login</button>
        </form>
      </div>
    `);
  });

  app.post('/login', async (request, reply) => {
    const { token } = request.body as { token?: string };
    if (token) {
      reply.setCookie('dev_token', token, { httpOnly: true, path: '/' });
    }
    reply.redirect('/');
  });

  // Home page.
  app.get('/', async (_request, reply) => {
    reply.type('text/html');
    return renderLayout({ title: 'Home', token: options.devToken }, `
      <div class="card">
        <h2>safe-npm Registry</h2>
        <p>Welcome to the safe-npm registry web UI.</p>
        <p><a href="/packages" class="btn btn-primary">View Packages</a></p>
        <p><a href="/stage" class="btn btn-primary">Review Staged Packages</a></p>
      </div>
    `);
  });

  // Package list.
  app.get('/packages', async (_request, reply) => {
    try {
      const packages = await api.listPackages();
      reply.type('text/html');
      return renderPackageList(packages, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to load packages');
    }
  });

  // Package detail.
  app.get('/packages/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const pkg = await api.getPackage(name);
      reply.type('text/html');
      return renderPackageDetail(pkg, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Package not found', 404);
    }
  });

  // Version detail.
  app.get('/packages/:name/versions/:version', async (request, reply) => {
    const { name, version } = request.params as { name: string; version: string };
    try {
      const ver = await api.getVersion(name, version);
      reply.type('text/html');
      return renderVersionDetail(name, ver, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Version not found', 404);
    }
  });

  // Access management.
  app.get('/packages/:name/access', async (request, reply) => {
    const { name } = request.params as { name: string };
    try {
      const shares = await api.listShares(name);
      reply.type('text/html');
      return renderAccessManagement(name, shares, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to load access info');
    }
  });

  // Grant share.
  app.post('/packages/:name/shares', async (request, reply) => {
    const { name } = request.params as { name: string };
    const body = request.body as { principalType?: string; principalId?: string; role?: string };
    try {
      // Get package ID from the packument.
      const pkg = await api.getPackage(name);
      await api.grantShare((pkg as unknown as { id: string }).id, body.principalType!, body.principalId!, body.role!);
      reply.redirect(`/packages/${encodeURIComponent(name)}/access`);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to grant share');
    }
  });

  // Revoke share.
  app.post('/packages/:name/shares/:shareId/revoke', async (request, reply) => {
    const { name, shareId } = request.params as { name: string; shareId: string };
    try {
      await api.revokeShare(shareId);
      reply.redirect(`/packages/${encodeURIComponent(name)}/access`);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to revoke share');
    }
  });

  // Stage list.
  app.get('/stage', async (_request, reply) => {
    try {
      const stages = await api.listStaged();
      reply.type('text/html');
      return renderStageList(stages, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to load staged packages');
    }
  });

  // Stage detail.
  app.get('/stage/:stageId', async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    try {
      // In a real implementation, this would fetch the stage detail from the API.
      // For MVP, we render with the stage ID.
      const stage = {
        id: stageId,
        packageId: '',
        packageVersionId: '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      reply.type('text/html');
      return renderStageDetail(stage, options.devToken);
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Stage not found', 404);
    }
  });

  // Approve stage.
  app.post('/stage/:stageId/approve', async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const body = request.body as { reviewNotes?: string; confirmName?: string };
    try {
      await api.approveStage(stageId, body.reviewNotes);
      reply.redirect('/stage');
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to approve stage');
    }
  });

  // Reject stage.
  app.post('/stage/:stageId/reject', async (request, reply) => {
    const { stageId } = request.params as { stageId: string };
    const body = request.body as { reviewNotes?: string };
    try {
      await api.rejectStage(stageId, body.reviewNotes);
      reply.redirect('/stage');
    } catch (err) {
      reply.type('text/html');
      return renderError(err instanceof Error ? err.message : 'Failed to reject stage');
    }
  });
}

export { renderLayout, renderError, escapeHtml };
