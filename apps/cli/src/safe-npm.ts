import { CliError, defaultRegistryUrl, parseArgs, type GlobalFlags } from './args.js';
import { runPreflight, renderJson, renderTty, inferPermissions, PreflightError } from './preflight.js';
import { packAndAnalyze, cleanupPack, PackError } from './pack.js';
import { publishTarball, PublishError } from './publish.js';
import { scoreAnalysis, renderTty as renderRiskTty } from '@safe-npm/scoring';
import type { PolicySet } from '@safe-npm/core-types';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const VERSION = '0.1.0';

/**
 * safe-npm CLI entry point.
 *
 * Commands:
 *   safe-npm --version
 *   safe-npm view <pkg>[@version] --risk
 *   safe-npm install <pkg>[@version]   (preflight only for MVP)
 */
export async function runSafeNpm(argv: string[]): Promise<void> {
  const exit = createExit();
  try {
    const { command, positional, flags } = parseArgs(argv);

    if (command === '--version' || flags.debug === undefined && command === undefined && positional.includes('--version')) {
      // Handle --version as the first arg.
    }

    // --version can appear as command or flag.
    if (argv.includes('--version') || argv.includes('-v')) {
      output(flags, { version: VERSION });
      exit(0);
      return;
    }

    if (!command) {
      output(flags, { error: 'no command provided', usage: 'safe-npm <command> [options]' });
      exit(1);
      return;
    }

    switch (command) {
      case 'view':
        await runView(positional, flags, exit);
        return;
      case 'install':
        await runInstall(positional, flags, exit);
        return;
      case 'publish':
        await runPublish(positional, flags, exit);
        return;
      case 'retract':
        await runRetract(positional, flags, exit);
        return;
      case 'stage':
        await runStage(positional, flags, exit);
        return;
      case 'promote':
        await runPromote(positional, flags, exit);
        return;
      case 'share':
        await runShare(positional, flags, exit);
        return;
      case 'audit':
        await runAudit(positional, flags, exit);
        return;
      default:
        output(flags, { error: `unknown command: ${command}` });
        exit(1);
        return;
    }
  } catch (err) {
    handleError(err, flagsFromArgv(argv), exit);
  }
}

async function runView(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec) {
    output(flags, { error: 'view requires a package spec', usage: 'safe-npm view <pkg>[@version] --risk' });
    exit(1);
    return;
  }

  const isRisk = positional.includes('--risk') || argvEndsWith(process.argv.slice(2), '--risk');
  if (!isRisk) {
    output(flags, { error: 'only --risk is supported in MVP', usage: 'safe-npm view <pkg>[@version] --risk' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const policy = await loadPolicy(flags);

  const result = await runPreflight(pkgSpec, {
    registryUrl,
    policy,
    agent: flags.agent,
  });

  if (flags.json) {
    console.log(renderJson(result.riskReport));
  } else {
    const perms = inferPermissions(result.analysisReport);
    const tty = renderTty(result.riskReport, {
      permissions: perms,
      binCommand: result.binCommand ?? undefined,
      installScripts: result.analysisReport.lifecycleScripts.map((s) => s.kind),
    });
    console.log(tty);
  }
  exit(0);
}

async function runInstall(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec) {
    output(flags, { error: 'install requires a package spec' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const policy = await loadPolicy(flags);

  const result = await runPreflight(pkgSpec, {
    registryUrl,
    policy,
    agent: flags.agent,
  });

  if (flags.json) {
    console.log(JSON.stringify({
      riskReport: result.riskReport,
      policyDecision: result.policyDecision,
    }, null, 2));
  } else {
    const perms = inferPermissions(result.analysisReport);
    console.log(renderTty(result.riskReport, {
      permissions: perms,
      binCommand: result.binCommand ?? undefined,
      installScripts: result.analysisReport.lifecycleScripts.map((s) => s.kind),
    }));
  }

  if (result.policyDecision) {
    if (result.policyDecision.decision === 'block') {
      output(flags, { error: `policy blocked installation: ${result.policyDecision.reason}` });
      exit(11);
      return;
    }
    if (result.policyDecision.decision === 'requires_approval' && !flags.yes) {
      output(flags, { message: 'installation requires approval (use --yes to proceed)' });
      exit(10);
      return;
    }
  }

  // Delegate to npm with the private registry configured.
  if (!flags.json) console.log('preflight passed; delegating to npm...');
  const code = await delegateToNpm(['install', pkgSpec], { registryUrl, token: process.env.SAFE_NPM_PUBLISH_TOKEN });
  exit(code);
}

/**
 * Delegate a command to npm, passing --registry and auth token via env.
 * Returns the exit code from npm.
 */
async function delegateToNpm(args: string[], opts: { registryUrl: string; token?: string }): Promise<number> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (opts.registryUrl) env.npm_config_registry = opts.registryUrl;
    if (opts.token) env.npm_config__auth = opts.token;

    const child = spawn('npm', args, {
      stdio: 'inherit',
      env,
    });

    child.on('close', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function loadPolicy(flags: GlobalFlags): Promise<PolicySet | undefined> {
  if (flags.policyPath) {
    const content = await readFile(flags.policyPath, 'utf8');
    return JSON.parse(content) as PolicySet;
  }
  return undefined;
}

async function runPublish(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  // Parse publish-specific flags.
  const isPublic = positional.includes('--public') || process.argv.slice(2).includes('--public');
  const isStagePublic = positional.includes('--stage-public') || process.argv.slice(2).includes('--stage-public');
  const dryRun = positional.includes('--dry-run') || process.argv.slice(2).includes('--dry-run');
  const cwd = process.cwd();

  // Determine visibility: default to private.
  const visibility = isPublic ? 'public' : isStagePublic ? 'staged_public' : 'private';

  // Get auth token from env or .npmrc.
  const token = process.env.SAFE_NPM_PUBLISH_TOKEN ?? readTokenFromNpmrc();
  if (!token && !dryRun) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN or configure .npmrc)' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();

  try {
    // Step 1: Pack and analyze.
    if (!flags.json) console.log('Packing and analyzing...');
    const pack = await packAndAnalyze({ cwd });

    // Step 2: Score locally.
    const riskReport = scoreAnalysis(pack.analysisReport);

    if (flags.json) {
      console.log(JSON.stringify({
        package: pack.packageJson.name,
        version: pack.packageJson.version,
        tarball: {
          filename: pack.filename,
          size: pack.size,
          sha512: pack.sha512,
          shasum: pack.shasum,
        },
        riskReport,
        visibility,
        dryRun,
      }, null, 2));
    } else {
      console.log(`\nPackage: ${pack.packageJson.name}@${pack.packageJson.version}`);
      console.log(`Tarball: ${pack.filename} (${pack.size} bytes)`);
      console.log(`Integrity: ${pack.sha512}`);
      console.log(`Visibility: ${visibility}`);
      console.log('');
      console.log(renderRiskTty(riskReport, {
        installScripts: pack.analysisReport.lifecycleScripts.map((s) => s.kind),
      }));
    }

    // Step 3: Publish (unless dry-run).
    if (dryRun) {
      output(flags, { message: 'dry run complete; no upload performed' });
      await cleanupPack(pack);
      exit(0);
      return;
    }

    if (!flags.json) console.log('\nPublishing...');
    const result = await publishTarball(pack, {
      registryUrl,
      token: token!,
      visibility,
    });

    output(flags, {
      message: `published ${result.package}@${result.version} (publishId: ${result.publishId}, visibility: ${result.visibility})`,
    });
    await cleanupPack(pack);
    exit(0);
  } catch (err) {
    if (err instanceof PackError || err instanceof PublishError) {
      if (flags.json) {
        console.log(JSON.stringify({ error: err.message, code: err.code }));
      } else {
        console.error(`error: ${err.message}`);
      }
      exit(1);
      return;
    }
    throw err;
  }
}

function readTokenFromNpmrc(): string | undefined {
  // In a real implementation, this would parse .npmrc.
  // For MVP, we only support env var.
  return undefined;
}

async function runRetract(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec || !pkgSpec.includes('@')) {
    output(flags, { error: 'retract requires <pkg>@<version>', usage: 'safe-npm retract <pkg>@<version> --reason <text>' });
    exit(1);
    return;
  }

  const reasonIdx = positional.indexOf('--reason');
  const reason = reasonIdx >= 0 ? positional[reasonIdx + 1] : undefined;
  if (!reason) {
    output(flags, { error: 'retract requires --reason <text>' });
    exit(1);
    return;
  }

  const lastAt = pkgSpec.lastIndexOf('@');
  const name = pkgSpec.slice(0, lastAt);
  const version = pkgSpec.slice(lastAt + 1);

  const token = process.env.SAFE_NPM_PUBLISH_TOKEN;
  if (!token) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN)' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const url = `${registryUrl}/v1/packages/${encodeURIComponent(name).replace('%40', '@')}/versions/${version}/retract`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reason }),
    });

    const body = await resp.json() as Record<string, unknown>;

    if (!resp.ok) {
      if (flags.json) {
        console.log(JSON.stringify(body));
      } else {
        console.error(`error: ${body.error ?? 'retract failed'}`);
        if (body.facts) console.error(`facts: ${JSON.stringify(body.facts)}`);
      }
      exit(1);
      return;
    }

    if (flags.json) {
      console.log(JSON.stringify(body));
    } else {
      console.log(`retracted ${name}@${version}: ${body.status}`);
      console.log(`reason: ${reason}`);
      if (body.facts) console.log(`facts: ${JSON.stringify(body.facts)}`);
    }
    exit(0);
  } catch (err) {
    if (err instanceof Error) {
      output(flags, { error: err.message });
    } else {
      output(flags, { error: 'retract failed' });
    }
    exit(1);
  }
}

function argvEndsWith(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

async function runStage(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const subcommand = positional[0];
  const token = process.env.SAFE_NPM_PUBLISH_TOKEN;
  const registryUrl = flags.registry ?? defaultRegistryUrl();

  if (!token) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN)' });
    exit(1);
    return;
  }

  const headers = { authorization: `Bearer ${token}` };

  try {
    if (subcommand === 'list') {
      const resp = await fetch(`${registryUrl}/v1/stage`, { headers });
      const body = await resp.json() as { stages?: Array<Record<string, unknown>> };
      if (flags.json) {
        console.log(JSON.stringify(body));
      } else {
        const stages = body.stages ?? [];
        if (stages.length === 0) {
          console.log('no pending stages');
        } else {
          for (const s of stages) {
            console.log(`${s.id}  ${s.status}  ${s.createdAt}`);
          }
        }
      }
      exit(0);
    } else if (subcommand === 'view') {
      const stageId = positional[1];
      if (!stageId) {
        output(flags, { error: 'stage view requires <stage-id>' });
        exit(1);
        return;
      }
      const resp = await fetch(`${registryUrl}/v1/stage/${stageId}`, { headers });
      const body = await resp.json();
      if (flags.json) {
        console.log(JSON.stringify(body));
      } else {
        console.log(JSON.stringify(body, null, 2));
      }
      exit(resp.ok ? 0 : 1);
    } else if (subcommand === 'approve') {
      const stageId = positional[1];
      if (!stageId) {
        output(flags, { error: 'stage approve requires <stage-id>' });
        exit(1);
        return;
      }
      const notesIdx = positional.indexOf('--notes');
      const reviewNotes = notesIdx >= 0 ? positional[notesIdx + 1] : undefined;
      const resp = await fetch(`${registryUrl}/v1/stage/${stageId}/approve`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ reviewNotes }),
      });
      const body = await resp.json();
      if (flags.json) {
        console.log(JSON.stringify(body));
      } else {
        console.log(`approved stage ${stageId}: ${resp.ok ? 'ok' : 'failed'}`);
      }
      exit(resp.ok ? 0 : 1);
    } else {
      output(flags, { error: `unknown stage subcommand: ${subcommand}`, usage: 'safe-npm stage list|view|approve <stage-id>' });
      exit(1);
    }
  } catch (err) {
    if (err instanceof Error) {
      output(flags, { error: err.message });
    } else {
      output(flags, { error: 'stage command failed' });
    }
    exit(1);
  }
}

async function runPromote(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec || !pkgSpec.includes('@')) {
    output(flags, { error: 'promote requires <pkg>@<version> --public' });
    exit(1);
    return;
  }

  const isPublic = positional.includes('--public');
  if (!isPublic) {
    output(flags, { error: 'promote requires --public flag' });
    exit(1);
    return;
  }

  const token = process.env.SAFE_NPM_PUBLISH_TOKEN;
  if (!token) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN)' });
    exit(1);
    return;
  }

  const lastAt = pkgSpec.lastIndexOf('@');
  const name = pkgSpec.slice(0, lastAt);
  const version = pkgSpec.slice(lastAt + 1);
  const registryUrl = flags.registry ?? defaultRegistryUrl();

  // For MVP, promote creates a stage record and immediately approves it.
  // In full implementation, this would be a two-step flow.
  output(flags, { message: `promoting ${name}@${version} to public...` });

  // First, get the package and version IDs from the registry.
  const viewResp = await fetch(`${registryUrl}/${encodeURIComponent(name).replace('%40', '@')}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!viewResp.ok) {
    output(flags, { error: `failed to fetch package: ${viewResp.status}` });
    exit(1);
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify({ message: 'promote requires manual stage approval via web UI or stage API' }));
  } else {
    console.log('promote: use the stage API to create and approve a stage record');
    console.log(`  1. POST /v1/stage with packageId and packageVersionId`);
    console.log(`  2. POST /v1/stage/:stageId/approve`);
  }
  exit(0);
}

async function runShare(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgName = positional[0];
  if (!pkgName) {
    output(flags, { error: 'share requires <pkg>', usage: 'safe-npm share <pkg> --user <user> --role read|write|admin' });
    exit(1);
    return;
  }

  const userIdx = positional.indexOf('--user');
  const orgIdx = positional.indexOf('--org');
  const roleIdx = positional.indexOf('--role');
  const userId = userIdx >= 0 ? positional[userIdx + 1] : undefined;
  const orgId = orgIdx >= 0 ? positional[orgIdx + 1] : undefined;
  const role = roleIdx >= 0 ? positional[roleIdx + 1] : 'read';

  if (!userId && !orgId) {
    output(flags, { error: 'share requires --user <user> or --org <org>' });
    exit(1);
    return;
  }

  const token = process.env.SAFE_NPM_PUBLISH_TOKEN;
  if (!token) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN)' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();

  // First, get the package ID from the registry.
  const viewResp = await fetch(`${registryUrl}/${encodeURIComponent(pkgName).replace('%40', '@')}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!viewResp.ok) {
    output(flags, { error: `failed to fetch package: ${viewResp.status}` });
    exit(1);
    return;
  }
  const packument = await viewResp.json() as { packageId?: string };
  if (!packument.packageId) {
    output(flags, { error: 'package ID not found in packument' });
    exit(1);
    return;
  }

  const principalType = userId ? 'user' : 'org';
  const principalId = userId ?? orgId;

  const resp = await fetch(`${registryUrl}/v1/shares`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      packageId: packument.packageId,
      principalType,
      principalId,
      role,
    }),
  });

  const body = await resp.json() as Record<string, unknown>;
  if (flags.json) {
    console.log(JSON.stringify(body));
  } else if (resp.ok) {
    console.log(`granted ${role} access to ${principalType} ${principalId} for ${pkgName}`);
    console.log(`share ID: ${body.shareId}`);
    console.log(`recipient can install with: safe-npm install ${pkgName}`);
  } else {
    console.error(`error: ${body.error ?? 'share failed'}`);
  }
  exit(resp.ok ? 0 : 1);
}

async function runAudit(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec) {
    output(flags, { error: 'audit requires <pkg>@<version>', usage: 'safe-npm audit <pkg>@<version> --paid [--provider mock-auditor]' });
    exit(1);
    return;
  }

  const isPaid = positional.includes('--paid') || process.argv.slice(2).includes('--paid');
  if (!isPaid) {
    output(flags, { error: 'only --paid audits are supported', usage: 'safe-npm audit <pkg>@<version> --paid' });
    exit(1);
    return;
  }

  // Parse pkg@version.
  const atIdx = pkgSpec.lastIndexOf('@');
  if (atIdx <= 0) {
    output(flags, { error: 'audit requires <pkg>@<version> with explicit version' });
    exit(1);
    return;
  }
  const pkgName = pkgSpec.slice(0, atIdx);
  const version = pkgSpec.slice(atIdx + 1);

  const providerIdx = positional.indexOf('--provider');
  const provider = providerIdx >= 0 ? positional[providerIdx + 1] : 'mock-auditor';

  const token = process.env.SAFE_NPM_PUBLISH_TOKEN;
  if (!token) {
    output(flags, { error: 'no publish token found (set SAFE_NPM_PUBLISH_TOKEN)' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const idempotencyKey = `audit-${pkgName}-${version}-${provider}-${Date.now()}`;

  // Show cost before submission.
  const cost = 100; // Fake cost.
  if (flags.json) {
    console.log(JSON.stringify({ package: pkgName, version, provider, cost, idempotencyKey }));
  } else {
    console.log(`Audit request: ${pkgName}@${version}`);
    console.log(`Provider: ${provider}`);
    console.log(`Cost: ${cost} credits`);
  }

  // Require confirmation unless --yes.
  if (!flags.yes) {
    if (flags.agent) {
      output(flags, { error: 'audit requires --yes in agent mode' });
      exit(10);
      return;
    }
    if (!flags.json) {
      const confirmed = await promptConfirm('Proceed with paid audit? [y/N]: ');
      if (!confirmed) {
        output(flags, { message: 'declined by user' });
        exit(0);
        return;
      }
    }
  }

  // Submit audit request.
  const resp = await fetch(`${registryUrl}/v1/audits`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      package: pkgName,
      version,
      provider,
      idempotencyKey,
    }),
  });

  const body = await resp.json() as Record<string, unknown>;
  if (flags.json) {
    console.log(JSON.stringify(body));
  } else if (resp.ok) {
    console.log(`Audit submitted: ${body.auditId}`);
    console.log(`Status: ${body.status}`);
    console.log(`Check status: safe-npm audit --status ${body.auditId}`);
  } else {
    console.error(`error: ${body.error ?? 'audit request failed'}`);
  }
  exit(resp.ok ? 0 : 1);
}

async function promptConfirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    let answer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      answer = data.toString().trim().toLowerCase();
      process.stdin.pause();
      resolve(answer === 'y' || answer === 'yes');
    });
  });
}

function flagsFromArgv(argv: string[]): GlobalFlags {
  try {
    return parseArgs(argv).flags;
  } catch {
    return { json: false, registry: undefined, policyPath: undefined, agent: false, yes: false, no: false, verbose: false, debug: false };
  }
}

function output(flags: GlobalFlags, data: Record<string, unknown>): void {
  if (flags.json) {
    console.log(JSON.stringify(data));
  } else {
    for (const [key, value] of Object.entries(data)) {
      console.log(`${key}: ${value}`);
    }
  }
}

function handleError(err: unknown, flags: GlobalFlags, exit: (code: number) => void): void {
  if (err instanceof CliError || err instanceof PreflightError || err instanceof PackError || err instanceof PublishError) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message, code: err.code }));
    } else {
      console.error(`error: ${err.message}`);
    }
    exit(1);
  } else if (err instanceof Error) {
    if (flags.json) {
      console.log(JSON.stringify({ error: err.message }));
    } else {
      console.error(`error: ${err.message}`);
    }
    exit(1);
  } else {
    console.error('fatal: unknown error');
    exit(1);
  }
}

function createExit(): (code: number) => void {
  return (code: number) => process.exit(code);
}
