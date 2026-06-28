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

function argvEndsWith(argv: string[], flag: string): boolean {
  return argv.includes(flag);
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
