import type { RiskFinding, AnalysisReport } from '@safe-npm/core-types';
import type { PackageJsonShape } from './metadata.js';

const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly',
] as const;

const SHELL_METACHARS = /[;&|`$()><\n]/;

const NETWORK_TOOLS: Record<string, true> = {
  curl: true,
  wget: true,
  nc: true,
  ssh: true,
  scp: true,
};

const PACKAGE_MANAGERS: Record<string, true> = {
  npm: true,
  npx: true,
  pnpm: true,
  yarn: true,
  bun: true,
};

export interface ScriptAnalysisResult {
  lifecycleScripts: string[];
  findings: RiskFinding[];
}

/**
 * Analyze package.json scripts for risky behavior without executing them.
 */
export function analyzeScripts(
  pkg: PackageJsonShape,
  bindingGypPresent: boolean,
): ScriptAnalysisResult {
  const scripts = pkg.scripts ?? {};
  const present = LIFECYCLE_SCRIPTS.filter((name) => typeof scripts[name] === 'string');
  const findings: RiskFinding[] = [];

  for (const name of present) {
    const cmd = scripts[name] ?? '';
    findings.push({
      code: 'LIFECYCLE_SCRIPT_PRESENT',
      severity: name === 'postinstall' || name === 'preinstall' ? 'medium' : 'low',
      message: `Package has a ${name} script.`,
      evidence: [`package.json:scripts.${name}`],
    });

    if (SHELL_METACHARS.test(cmd)) {
      findings.push({
        code: 'SCRIPT_SHELL_METACHAR',
        severity: 'medium',
        message: `${name} script contains shell metacharacters.`,
        evidence: [`package.json:scripts.${name}: ${truncate(cmd)}`],
      });
    }

    // detect network tools
    for (const tool of Object.keys(NETWORK_TOOLS)) {
      if (containsWord(cmd, tool)) {
        findings.push({
          code: 'SCRIPT_NETWORK_TOOL',
          severity: 'high',
          message: `${name} script invokes network tool ${tool}.`,
          evidence: [`package.json:scripts.${name}: ${truncate(cmd)}`],
        });
      }
    }

    // detect package manager commands inside install scripts
    for (const pm of Object.keys(PACKAGE_MANAGERS)) {
      if (containsWord(cmd, pm)) {
        findings.push({
          code: 'SCRIPT_PACKAGE_MANAGER',
          severity: 'medium',
          message: `${name} script invokes package manager ${pm}.`,
          evidence: [`package.json:scripts.${name}: ${truncate(cmd)}`],
        });
      }
    }
  }

  // node-gyp implicit native build
  if (bindingGypPresent) {
    const hasInstallScript = present.includes('install') || present.includes('postinstall');
    if (hasInstallScript) {
      findings.push({
        code: 'NODE_GYP_IMPLICIT_BUILD',
        severity: 'medium',
        message: 'binding.gyp present with install script implies native build via node-gyp.',
        evidence: ['binding.gyp', 'package.json:scripts'],
      });
    }
  }

  return { lifecycleScripts: [...present], findings };
}

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

/** Word-boundary match for a command name in a shell string. */
function containsWord(haystack: string, needle: string): boolean {
  const re = new RegExp(`(^|[^\\w.-])${escapeRe(needle)}([^\\w.-]|$)`, 'i');
  return re.test(haystack);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Attach script analysis results to an AnalysisReport. */
export function applyScriptAnalysis(
  report: AnalysisReport,
  result: ScriptAnalysisResult,
): void {
  report.lifecycleScripts = result.lifecycleScripts;
  report.scriptFindings = result.findings;
}
