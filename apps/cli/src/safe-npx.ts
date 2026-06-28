import { CliError, defaultRegistryUrl, parseArgs, type GlobalFlags } from './args.js';
import { runPreflight, renderTty, inferPermissions, PreflightError } from './preflight.js';
import type { PolicySet } from '@safe-npm/core-types';
import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { readFile } from 'node:fs/promises';
import { scanMarkdownFile, deduplicateCommands, type DetectedCommand } from './skill-scanner.js';

const VERSION = '0.1.0';

/**
 * safe-npx CLI entry point.
 *
 * Commands:
 *   safe-npx --version
 *   safe-npx preflight <pkg>[@version]
 *   safe-npx <pkg>[@version] [args...]   (preflight + prompt, no exec in MVP)
 */
export async function runSafeNpx(argv: string[]): Promise<void> {
  const exit = createExit();
  try {
    // --version
    if (argv.includes('--version') || argv.includes('-v')) {
      const flags = safeFlags(argv);
      output(flags, { version: VERSION });
      exit(0);
      return;
    }

    const { command, positional, flags } = parseArgs(argv);

    if (command === 'preflight') {
      await runPreflightCommand(positional, flags, exit);
      return;
    }

    if (command === 'scan-skill') {
      await runScanSkillCommand(positional, flags, exit);
      return;
    }

    if (command === 'policy') {
      await runPolicyCommand(positional, flags, exit);
      return;
    }

    // No subcommand: treat the whole thing as a package spec to execute.
    // Re-parse with the first positional as the package spec.
    if (command) {
      const pkgSpec = command;
      const extraArgs = positional;
      await runExec(pkgSpec, extraArgs, flags, exit);
      return;
    }

    output(flags, { error: 'no package specified', usage: 'safe-npx <pkg>[@version] [args...]' });
    exit(1);
  } catch (err) {
    handleError(err, safeFlags(argv), exit);
  }
}

async function runPreflightCommand(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const pkgSpec = positional[0];
  if (!pkgSpec) {
    output(flags, { error: 'preflight requires a package spec' });
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
      package: result.spec.name,
      version: result.resolvedVersion,
      bin: result.binCommand,
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
  exit(0);
}

async function runScanSkillCommand(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const path = positional[0];
  if (!path) {
    output(flags, { error: 'scan-skill requires a file path' });
    exit(1);
    return;
  }

  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const policy = await loadPolicy(flags);

  const scan = await scanMarkdownFile(path);
  const unique = deduplicateCommands(scan.commands);

  const results: Array<{
    command: DetectedCommand;
    decision: 'pass' | 'approval' | 'block';
    riskReport?: unknown;
    policyDecision?: unknown;
    error?: string;
  }> = [];

  let anyBlocked = false;
  let anyApproval = false;

  for (const cmd of unique) {
    try {
      const result = await runPreflight(cmd.packageSpec, {
        registryUrl,
        policy,
        agent: flags.agent,
      });
      let decision: 'pass' | 'approval' | 'block' = 'pass';
      if (result.policyDecision) {
        if (result.policyDecision.decision === 'block') {
          decision = 'block';
          anyBlocked = true;
        } else if (result.policyDecision.decision === 'requires_approval') {
          decision = 'approval';
          anyApproval = true;
        }
      }
      results.push({
        command: cmd,
        decision,
        riskReport: result.riskReport,
        policyDecision: result.policyDecision,
      });
    } catch (err) {
      results.push({
        command: cmd,
        decision: 'block',
        error: err instanceof Error ? err.message : String(err),
      });
      anyBlocked = true;
    }
  }

  if (flags.json) {
    console.log(JSON.stringify({
      file: path,
      results,
    }, null, 2));
  } else {
    console.log(`Scan: ${path}`);
    console.log(`Found ${scan.commands.length} command(s), ${unique.length} unique package(s)`);
    for (const r of results) {
      const c = r.command;
      console.log(`  [${r.decision.toUpperCase()}] line ${c.line}: ${c.tool} ${c.packageSpec}`);
      if (r.error) console.log(`    error: ${r.error}`);
    }
  }

  if (anyBlocked) exit(11);
  else if (anyApproval) exit(10);
  else exit(0);
}

async function runPolicyCommand(positional: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const subcommand = positional[0];
  if (!subcommand) {
    output(flags, { error: 'policy requires a subcommand', usage: 'safe-npx policy init|test [args]' });
    exit(1);
    return;
  }

  if (subcommand === 'init') {
    const presetIdx = positional.indexOf('--preset');
    const presetName = presetIdx >= 0 ? positional[presetIdx + 1] : 'agent';
    const { getPreset, listPresets } = await import('@safe-npm/scoring');
    const preset = getPreset(presetName);
    if (!preset) {
      output(flags, { error: `unknown preset: ${presetName}`, available: listPresets() });
      exit(1);
      return;
    }
    const policyPath = '.safe-npx-policy.json';
    const { writeFile: writeFileFn } = await import('node:fs/promises');
    await writeFileFn(policyPath, JSON.stringify(preset, null, 2) + '\n', 'utf8');
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, path: policyPath, preset: presetName }));
    } else {
      console.log(`Created policy file: ${policyPath} (preset: ${presetName})`);
    }
    exit(0);
    return;
  }

  if (subcommand === 'test') {
    const reportPath = positional[1];
    if (!reportPath) {
      output(flags, { error: 'policy test requires a risk report file', usage: 'safe-npx policy test <risk-report.json>' });
      exit(1);
      return;
    }
    const policy = await loadPolicy(flags);
    if (!policy) {
      output(flags, { error: 'no policy configured', hint: 'run: safe-npx policy init' });
      exit(1);
      return;
    }
    const reportContent = await readFile(reportPath, 'utf8');
    const report = JSON.parse(reportContent);
    const { evaluatePolicy } = await import('@safe-npm/scoring');
    const actionIdx = positional.indexOf('--action');
    const action = (actionIdx >= 0 ? positional[actionIdx + 1] : 'exec') as 'install' | 'exec' | 'publish';
    const decision = evaluatePolicy(report, action, policy);
    if (flags.json) {
      console.log(JSON.stringify(decision, null, 2));
    } else {
      console.log(`Decision: ${decision.decision}`);
      console.log(`Action: ${decision.action}`);
      if (decision.matchedRules.length > 0) {
        console.log('Matched rules:');
        for (const rule of decision.matchedRules) {
          console.log(`  ${rule.path}: expected ${JSON.stringify(rule.expected)}, got ${JSON.stringify(rule.actual)}`);
        }
      }
    }
    exit(decision.decision === 'block' ? 11 : decision.decision === 'requires_approval' ? 10 : 0);
    return;
  }

  output(flags, { error: `unknown policy subcommand: ${subcommand}` });
  exit(1);
}

async function runExec(pkgSpec: string, extraArgs: string[], flags: GlobalFlags, exit: (code: number) => void): Promise<void> {
  const registryUrl = flags.registry ?? defaultRegistryUrl();
  const policy = await loadPolicy(flags);

  const result = await runPreflight(pkgSpec, {
    registryUrl,
    policy,
    agent: flags.agent,
  });

  // Render risk info.
  if (flags.json) {
    console.log(JSON.stringify({
      package: result.spec.name,
      version: result.resolvedVersion,
      bin: result.binCommand,
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

  // Policy decision.
  if (result.policyDecision) {
    const dec = result.policyDecision;
    if (dec.decision === 'block') {
      output(flags, { error: `policy blocked execution: ${dec.reason}` });
      exit(11);
      return;
    }
    if (dec.decision === 'requires_approval') {
      if (flags.yes) {
        // --yes skips the prompt (even in agent mode).
      } else if (flags.agent) {
        // Agent mode without --yes: deterministic exit code 10.
        output(flags, { error: `execution requires approval: ${dec.reason}` });
        exit(10);
        return;
      } else if (flags.no) {
        output(flags, { message: 'declined by --no' });
        exit(0);
        return;
      } else {
        // TTY prompt.
        const approved = await promptUser(flags);
        if (!approved) {
          output(flags, { message: 'declined by user' });
          exit(0);
          return;
        }
      }
    }
  }

  // MVP: no actual execution.
  output(flags, { message: `execution would start: ${result.binCommand ?? result.spec.name} ${extraArgs.join(' ')}` });
  exit(0);
}

async function promptUser(flags: GlobalFlags): Promise<boolean> {
  if (flags.json) return false; // Non-interactive in JSON mode.
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question('Proceed? [y]es / [n]o / [d]etails: ');
    const lower = answer.trim().toLowerCase();
    if (lower === 'y' || lower === 'yes') return true;
    if (lower === 'd' || lower === 'details') {
      // Show full report again and re-prompt.
      const answer2 = await rl.question('Proceed? [y]es / [n]o: ');
      return answer2.trim().toLowerCase() === 'y' || answer2.trim().toLowerCase() === 'yes';
    }
    return false;
  } finally {
    rl.close();
  }
}

async function loadPolicy(flags: GlobalFlags): Promise<PolicySet | undefined> {
  if (flags.policyPath) {
    const content = await readFile(flags.policyPath, 'utf8');
    return JSON.parse(content) as PolicySet;
  }
  return undefined;
}

function safeFlags(argv: string[]): GlobalFlags {
  try {
    return parseArgs(argv).flags;
  } catch {
    // parseArgs failed; check if --json was present in the raw argv.
    const json = argv.includes('--json');
    return { json, registry: undefined, policyPath: undefined, agent: false, yes: false, no: false, verbose: false, debug: false };
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
  if (err instanceof CliError || err instanceof PreflightError) {
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
