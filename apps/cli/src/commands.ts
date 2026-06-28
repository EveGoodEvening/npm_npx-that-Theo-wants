import { readFile } from 'node:fs/promises';
import type { RiskReport, AnalysisReport, PolicyDecision, PolicySet } from '@safe-npm/core-types';
import { SafeNpmError, toCliExitCode, PolicySetSchema } from '@safe-npm/core-types';
import { runPreflight } from './preflight.js';
import { renderTty, DEFAULT_HUMAN_POLICY, DEFAULT_AGENT_POLICY } from '@safe-npm/scoring';

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
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
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
 * `safe-npx <pkg>` no-exec prompt path.
 * Preflights, applies policy, and prompts in TTY (or returns JSON in agent mode).
 * Does NOT execute the package in this step.
 */
export async function execPreflightCommand(
  pkgSpec: string,
  flags: GlobalFlags,
  promptFn: (report: RiskReport, analysis: AnalysisReport) => Promise<'yes' | 'no' | 'details'>,
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
      return 0;
    }

    // TTY mode.
    if (decision.decision === 'blocked') {
      getErr(flags)('Blocked by policy: ' + (decision.reason ?? 'blockers present') + '\n');
      return 11;
    }
    if (decision.decision === 'allow') {
      getOut(flags)('execution would start\n');
      return 0;
    }
    // requires_approval -> prompt
    getOut(flags)(renderTty(riskReport, analysis) + '\n');
    const answer = await promptFn(riskReport, analysis);
    if (answer === 'yes') {
      getOut(flags)('execution would start\n');
      return 0;
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
