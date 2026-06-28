import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import type { RiskReport, AnalysisReport, PolicyDecision, PolicySet, PolicyAction } from '@safe-npm/core-types';
import { SafeNpmError, toCliExitCode, PolicySetSchema, RiskReportSchema } from '@safe-npm/core-types';
import { runPreflight } from './preflight.js';
import type { PreflightResult } from './preflight.js';
import { installIntoCache, resolveInstalledBin, executeBin, createExecCache, execCacheKey, buildPermissionFlags, loadTrustCache, isTrusted, addTrustEntry } from './execution.js';
import { renderTty, DEFAULT_HUMAN_POLICY, DEFAULT_AGENT_POLICY, getPreset, evaluatePolicy, scoreAnalysis } from '@safe-npm/scoring';
import { scanAndPreflight, scanExitCode } from './scan-skill.js';
import { analyzeTarball } from '@safe-npm/analyzer';
import { createHash } from 'node:crypto';
export interface GlobalFlags {
  json: boolean;
  registry?: string;
  policyPath?: string;
  agent: boolean;
  yes: boolean;
  no: boolean;
  verbose: boolean;
  debug: boolean;
  /** Test/programmatic fetch injection. */
  fetchImpl?: typeof fetch;
  /** Output writer (defaults to process.stdout). */
  out?: (s: string) => void;
  /** Error writer (defaults to process.stderr). */
  err?: (s: string) => void;
}

export type Writer = (s: string) => void;
function getOut(flags: GlobalFlags): Writer {
  return flags.out ?? ((s) => process.stdout.write(s));
}
function getErr(flags: GlobalFlags): Writer {
  return flags.err ?? ((s) => process.stderr.write(s));
}

export function parseGlobalFlags(args: string[]): { flags: GlobalFlags; rest: string[] } {
  const flags: GlobalFlags = {
    json: false,
    agent: false,
    yes: false,
    no: false,
    verbose: false,
    debug: false,
  };
  const rest: string[] = [];
  let seenSeparator = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!seenSeparator && a === '--') {
      // everything after -- is a positional/exec arg, not a flag
      seenSeparator = true;
      continue;
    }
    if (seenSeparator) {
      rest.push(a);
      continue;
    }
    if (a === '--json') flags.json = true;
    else if (a === '--agent') flags.agent = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--no' || a === '-n') flags.no = true;
    else if (a === '--verbose') flags.verbose = true;
    else if (a === '--debug') flags.debug = true;
    else if (a === '--registry') {
      flags.registry = args[++i];
    } else if (a === '--policy') {
      flags.policyPath = args[++i];
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

/** Load a policy from a path, or return the default for the mode. */
export async function loadPolicy(flags: GlobalFlags): Promise<PolicySet> {
  if (flags.policyPath) {
    const raw = await readFile(flags.policyPath, 'utf8');
    return PolicySetSchema.parse(JSON.parse(raw));
  }
  return flags.agent ? DEFAULT_AGENT_POLICY : DEFAULT_HUMAN_POLICY;
}

/** `safe-npm view <pkg> [--risk] [--json]` */
export async function viewCommand(pkgSpec: string, flags: GlobalFlags): Promise<number> {
  try {
    const policy = await loadPolicy(flags);
    const result = await runPreflight({
      spec: pkgSpec,
      registryUrl: flags.registry,
      policy,
      agentMode: flags.agent,
      fetchImpl: flags.fetchImpl,
    });
    if (flags.json) {
      const out = {
        package: result.riskReport.package,
        version: result.riskReport.version,
        score: result.riskReport.score,
        tier: result.riskReport.tier,
        confidence: result.riskReport.confidence,
        blockers: result.riskReport.blockers,
        warnings: result.riskReport.warnings,
        decision: result.decision,
      };
      getOut(flags)(JSON.stringify(out, null, 2) + '\n');
    } else {
      getOut(flags)(renderTty(result.riskReport, result.analysis) + '\n');
    }
    return 0;
  } catch (err) {
    return handleError(err, flags);
  }
}

/** `safe-npx preflight <pkg>[@version] [--json]` */
export async function preflightCommand(pkgSpec: string, flags: GlobalFlags): Promise<number> {
  try {
    const policy = await loadPolicy(flags);
    const result = await runPreflight({
      spec: pkgSpec,
      registryUrl: flags.registry,
      policy,
      agentMode: flags.agent,
      fetchImpl: flags.fetchImpl,
    });
    if (flags.json) {
      const out = {
        package: result.riskReport.package,
        version: result.riskReport.version,
        score: result.riskReport.score,
        tier: result.riskReport.tier,
        confidence: result.riskReport.confidence,
        bin: result.selectedBin,
        decision: result.decision,
        riskReport: result.riskReport,
      };
      getOut(flags)(JSON.stringify(out, null, 2) + '\n');
    } else {
      getOut(flags)(renderTty(result.riskReport, result.analysis) + '\n');
      if (result.selectedBin) {
        getOut(flags)('\nBin: ' + result.selectedBin + '\n');
      }
      getOut(flags)('\nDecision: ' + result.decision.decision + '\n');
    }
    return 0;
  } catch (err) {
    return handleError(err, flags);
  }
}

/**
 * `safe-npx <pkg>` preflight + optional execution path.
 * When `options.execute` is true and policy allows (or user approves),
 * installs the package into the execution cache and runs the selected bin.
 */
export async function execPreflightCommand(
  pkgSpec: string,
  flags: GlobalFlags,
  promptFn: (report: RiskReport, analysis: AnalysisReport) => Promise<'yes' | 'no' | 'details'>,
  options: { execute?: boolean; execArgs?: string[] } = {},
): Promise<number> {
  try {
    const policy = await loadPolicy(flags);
    const result = await runPreflight({
      spec: pkgSpec,
      registryUrl: flags.registry,
      policy,
      agentMode: flags.agent,
      fetchImpl: flags.fetchImpl,
    });
    const { decision, riskReport, analysis } = result;

    if (flags.agent || flags.json) {
      // Agent mode: never prompt; deterministic JSON + exit code.
      const out = {
        decision: decision.decision,
        package: riskReport.package,
        version: riskReport.version,
        score: riskReport.score,
        tier: riskReport.tier,
        policy: { name: policy.name, reason: decision.reason },
        recommendedUserMessage: `Package ${riskReport.package}@${riskReport.version} scored ${riskReport.score}/100. ${
          decision.decision === 'allow'
            ? 'Allowed by policy.'
            : decision.decision === 'requires_approval'
              ? 'It needs human approval before execution.'
              : 'It is blocked by policy.'
        }`,
      };
      getOut(flags)(JSON.stringify(out, null, 2) + '\n');
      if (decision.decision === 'blocked') return 11;
      if (decision.decision === 'requires_approval') return 10;
      if (options.execute) return runExec(result, flags, options);
      return 0;
    }

    // TTY mode.
    if (decision.decision === 'blocked') {
      getErr(flags)('Blocked by policy: ' + (decision.reason ?? 'blockers present') + '\n');
      return 11;
    }
    if (decision.decision === 'allow') {
      return runExec(result, flags, options);
    }
    // requires_approval -> check trust cache, then prompt
    const trustCache = await loadTrustCache();
    const trusted = isTrusted(trustCache, riskReport.package, riskReport.version, analysis.tarballDigest);
    if (trusted) {
      return runExec(result, flags, options);
    }
    getOut(flags)(renderTty(riskReport, analysis) + '\n');
    const answer = await promptFn(riskReport, analysis);
    if (answer === 'yes') {
      // record trust for this exact version + digest
      await addTrustEntry({
        packageName: riskReport.package,
        version: riskReport.version,
        tarballDigest: analysis.tarballDigest,
        riskReportDigest: riskReport.evidenceDigest,
        scope: 'exact-version',
        createdAt: new Date().toISOString(),
      });
      return runExec(result, flags, options);
    }
    if (answer === 'details') {
      getOut(flags)(renderTty(riskReport, analysis) + '\n');
      return 1;
    }
    getOut(flags)('aborted\n');
    return 1;
  } catch (err) {
    return handleError(err, flags);
  }
}



/**
 * Install the approved package into the execution cache and run its bin.
 * Returns the child exit code (or 15 if enforcement required but unavailable).
 */
async function runExec(
  result: PreflightResult,
  flags: GlobalFlags,
  options: { execute?: boolean; execArgs?: string[] },
): Promise<number> {
  if (!options.execute) {
    getOut(flags)('execution would start\n');
    return 0;
  }
  const { packageName, version, riskReport, selectedBin, analysis } = result;
  if (!selectedBin) {
    getErr(flags)('no safe bin selectable for execution\n');
    return 14;
  }
  const cache = await createExecCache();
  const policyHash = flags.policyPath ?? (flags.agent ? 'agent' : 'human');
  const dest = execCacheKey(cache, packageName, version, analysis.tarballDigest, policyHash);
  await installIntoCache(dest, packageName, version, {
    ignoreScripts: true,
    registry: flags.registry,
  });
  const binPath = await resolveInstalledBin(dest, packageName, selectedBin);
  if (!binPath) {
    getErr(flags)(`could not resolve bin ${selectedBin} after install\n`);
    return 14;
  }
  const permissionFlags = riskReport.facts.permissions
    ? buildPermissionFlags(riskReport.facts.permissions)
    : [];
  const enforce = flags.agent && riskReport.facts.permissions?.enforceable === true;
  const execResult = await executeBin(binPath, {
    args: options.execArgs,
    tty: !flags.json && !flags.agent,
    permissionFlags,
    enforcePermissions: enforce,
  });
  if (execResult.exitCode === 15) {
    getErr(flags)('permission enforcement unavailable but required\n');
  }
  if (flags.json || flags.agent) {
    getOut(flags)(JSON.stringify({ executed: true, exitCode: execResult.exitCode, enforced: execResult.enforced }, null, 2) + '\n');
  }
  return execResult.exitCode;
}
/** `safe-npx scan-skill <path> [--json]` */
export async function scanSkillCommand(filePath: string, flags: GlobalFlags): Promise<number> {
  try {
    const result = await scanAndPreflight(filePath, async (spec) => {
      // reuse the preflight pipeline to get a decision
      const policy = await loadPolicy(flags);
      const pf = await runPreflight({
        spec,
        registryUrl: flags.registry,
        policy,
        agentMode: true,
        fetchImpl: flags.fetchImpl,
      });
      return {
        decision: pf.decision.decision === 'allow' ? 'allow' : pf.decision.decision === 'blocked' ? 'blocked' : 'requires_approval',
        reason: pf.decision.reason,
        resolvedVersion: pf.version,
      };
    });
    const code = scanExitCode(result);
    if (flags.json) {
      getOut(flags)(JSON.stringify(result, null, 2) + '\n');
    } else {
      getOut(flags)(`Scanned ${result.file}: ${result.commands.length} command(s)\n`);
      for (const c of result.commands) {
        getOut(flags)(`  line ${c.line}: ${c.tool} ${c.spec} -> ${c.decision}\n`);
      }
    }
    return code;
  } catch (err) {
    return handleError(err, flags);
  }
}

/** `safe-npm policy init|show|test` and `safe-npx policy init|test` */
export async function policyCommand(
  sub: string,
  args: string[],
  flags: GlobalFlags,
): Promise<number> {
  try {
    if (sub === 'init') {
      const preset = (args[0] ?? (flags.agent ? 'agent' : 'default')) as PolicySet['mode'];
      const validPresets: PolicySet['mode'][] = ['relaxed', 'default', 'strict', 'agent', 'ci'];
      if (!validPresets.includes(preset)) {
        getErr(flags)(`invalid preset '${preset}'; valid: ${validPresets.join(', ')}\n`);
        return 1;
      }
      const policy = getPreset(preset);
      const outPath = args[1] ?? './safe-npm-policy.json';
      await writeFile(outPath, JSON.stringify(policy, null, 2) + '\n');
      getOut(flags)(`wrote ${outPath} (${preset} preset)\n`);
      return 0;
    }
    if (sub === 'show') {
      const policy = await loadPolicy(flags);
      if (flags.json) {
        getOut(flags)(JSON.stringify(policy, null, 2) + '\n');
      } else {
        getOut(flags)(`Policy: ${policy.name} (mode ${policy.mode})\n`);
        getOut(flags)(`  install.minimumScore: ${policy.install.minimumScore ?? '(none)'}\n`);
        getOut(flags)(`  exec.minimumScore: ${policy.exec.minimumScore ?? '(none)'}\n`);
        getOut(flags)(`  exec.disallowLatestTag: ${policy.exec.disallowLatestTag}\n`);
        getOut(flags)(`  publish.defaultVisibility: ${policy.publish.defaultVisibility}\n`);
      }
      return 0;
    }
    if (sub === 'test') {
      const reportPath = args[0];
      if (!reportPath) {
        getErr(flags)('usage: policy test <risk-report.json> [action]\n');
        return 1;
      }
      const action = (args[1] ?? 'exec') as PolicyAction;
      const rawReport = JSON.parse(await readFile(reportPath, 'utf8'));
      const report = RiskReportSchema.parse(rawReport);
      const policy = await loadPolicy(flags);
      const decision = evaluatePolicy(policy, {
        riskReport: report,
        action,
        isExactVersion: /^\d+\.\d+\.\d+/.test(report.version),
      });
      if (flags.json) {
        getOut(flags)(JSON.stringify(decision, null, 2) + '\n');
      } else {
        getOut(flags)(`Decision: ${decision.decision} (allow=${decision.allow})\n`);
        if (decision.reason) getOut(flags)(`Reason: ${decision.reason}\n`);
        for (const r of decision.matchedRules) {
          getOut(flags)(`  matched: ${r.path} expected=${JSON.stringify(r.expected)} actual=${JSON.stringify(r.actual)}\n`);
        }
      }
      if (decision.decision === 'blocked') return 11;
      if (decision.decision === 'requires_approval') return 10;
      return 0;
    }
    getErr(flags)('usage: policy init [preset] [path] | policy show | policy test <risk-report.json> [action]\n');
    return 1;
  } catch (err) {
    return handleError(err, flags);
  }
}

/** `safe-npm publish [--private | --public | --stage-public]` skeleton. */
export async function publishCommand(args: string[], flags: GlobalFlags): Promise<number> {
  try {
    const visibility = args.includes('--public')
      ? 'public'
      : args.includes('--stage-public')
        ? 'staged_public'
        : 'private'; // default private
    if (visibility !== 'private' && !flags.yes && !flags.json && !args.includes('--yes')) {
      getErr(flags)(
        `publishing as ${visibility} requires explicit intent; use --public/--stage-public with --yes (or --json)\n`,
      );
      return 1;
    }

    // 1. Preview contents with npm pack --json --dry-run.
    const preview = await runNpmPack(true);
    if (flags.verbose || !flags.json) {
      getOut(flags)(`Pack preview: ${Number(preview)} file(s)\n`);
    }

    // 2. Actual pack: run in project cwd, write tarball into temp dir.
    const tmp = await mkdtemp(join(tmpdir(), 'safe-publish-'));
    try {
      const tarballName = await runNpmPack(false, process.cwd(), tmp);
      const tarballPath = join(tmp, tarballName);
      const buf = await readFile(tarballPath);
      const integrity = `sha512-${createHash('sha512').update(buf).digest('base64')}`;
      const shasum = createHash('sha1').update(buf).digest('hex');

      // 3. Read package.json for name/version.
      const pkgJson = JSON.parse(await readFile('package.json', 'utf8')) as {
        name: string;
        version: string;
      };

      // 4. Run local analyzer before upload.
      const unpackDir = join(tmp, 'unpacked');
      const { report: analysis, declaredPermissions } = await analyzeTarball({
        tarballPath,
        unpackDir,
        expectedName: pkgJson.name,
        expectedVersion: pkgJson.version,
      });
      const riskReport = scoreAnalysis({ analysis, declaredPermissions });

      // 5. Show local publish summary.
      const summary = {
        name: pkgJson.name,
        version: pkgJson.version,
        visibility,
        tarballSizeBytes: buf.byteLength,
        integrity,
        shasum,
        score: riskReport.score,
        tier: riskReport.tier,
        blockers: riskReport.blockers.length,
        warnings: riskReport.warnings.length,
      };
      if (flags.json) {
        getOut(flags)(JSON.stringify({ published: false, summary, note: 'upload not implemented in MVP' }, null, 2) + '\n');
      } else {
        getOut(flags)(`Publish summary: ${summary.name}@${summary.version} (${visibility})\n`);
        getOut(flags)(`  Size: ${buf.byteLength} bytes, integrity: ${integrity.slice(0, 24)}...\n`);
        getOut(flags)(`  Score: ${summary.score}/100 ${summary.tier}, blockers: ${summary.blockers}, warnings: ${summary.warnings}\n`);
        getOut(flags)(`  (upload to registry not implemented in MVP; tarball at ${tarballPath})\n`);
      }
      return 0;
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  } catch (err) {
    return handleError(err, flags);
  }
}

/** Run `npm pack --json` (dry-run or real) and return the result. */
async function runNpmPack(dryRun: boolean, cwd?: string, outDir?: string): Promise<string> {
  const args = ['pack', '--json'];
  if (dryRun) args.push('--dry-run');
  if (outDir) args.push('--pack-destination', outDir);
  return new Promise<string>((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`npm pack failed (exit ${code}): ${stderr.slice(-300)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as Array<{ filename?: string; files?: unknown[] }>;
        if (dryRun) {
          resolve(String(parsed[0]?.files?.length ?? 0));
        } else {
          resolve(parsed[0]?.filename ?? '');
        }
      } catch {
        reject(new Error('npm pack returned unparseable JSON'));
      }
    });
  });
}

function handleError(err: unknown, flags: GlobalFlags): number {
  const e = err instanceof SafeNpmError ? err : new SafeNpmError({
    code: 'INTERNAL_ERROR',
    message: err instanceof Error ? err.message : String(err),
    details: {},
  });
  if (flags.json) {
    getOut(flags)(JSON.stringify({ error: e.toJSON() }, null, 2) + '\n');
  } else {
    getErr(flags)(`${e.code}: ${e.message}\n`);
    if (e.remediation) getErr(flags)(`remediation: ${e.remediation}\n`);
  }
  return toCliExitCode(e.code);
}

export type { RiskReport, AnalysisReport, PolicyDecision };
