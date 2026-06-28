import type { AnalysisReport } from '@safe-npm/core-types';
import {
  type RiskReport,
  type RiskReport as RiskReportType,
  type RiskFinding,
} from '@safe-npm/core-types';

/**
 * Risk report renderers (design 5.2 / 9.1). Produces JSON and TTY summary
 * output from a {@link RiskReport}, optionally enriched with analysis facts.
 */

/** Render a RiskReport as a canonical JSON string (pretty-printed). */
export function renderJson(report: RiskReportType): string {
  return JSON.stringify(report, null, 2);
}

/** TTY color codes (no external dependency). */
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';

const TIER_COLORS: Record<string, string> = {
  excellent: GREEN,
  good: GREEN,
  caution: YELLOW,
  danger: RED,
  blocked: RED + BOLD,
};

const SEVERITY_COLORS: Record<string, string> = {
  low: DIM,
  medium: YELLOW,
  high: RED,
  critical: RED + BOLD,
};

export interface RenderTtyOptions {
  /** Inferred permissions to display (from analyzer). */
  permissions?: InferredPermissions;
  /** Author/publisher info from analysis. */
  author?: string;
  /** Maintainers from packument. */
  maintainers?: string[];
  /** Bin command resolved for this package. */
  binCommand?: string;
  /** Lifecycle scripts from analysis (shown as a dedicated field). */
  installScripts?: string[];
}

export interface InferredPermissions {
  fs?: boolean;
  net?: boolean;
  childProcess?: boolean;
  env?: boolean;
  nativeAddon?: boolean;
}

/**
 * Render a concise TTY summary of a RiskReport. Designed for `safe-npx`
 * interactive prompts and `safe-npm install` previews.
 */
export function renderTty(report: RiskReportType, options: RenderTtyOptions = {}): string {
  const lines: string[] = [];
  const tierColor = TIER_COLORS[report.tier] ?? RESET;

  lines.push(`${BOLD}${report.package}${RESET}@${BOLD}${report.version}${RESET}`);
  lines.push('');
  lines.push(`  Score:      ${tierColor}${report.score}/100 (${report.tier})${RESET}`);
  lines.push(`  Confidence: ${report.confidence}/100`);
  lines.push(`  Tarball:    ${formatBytes(report.facts.tarball?.sizeBytes ?? 0)} packed, ${formatBytes(report.facts.tarball?.unpackedSizeBytes ?? 0)} unpacked, ${report.facts.tarball?.fileCount ?? 0} files`);

  if (options.author) {
    lines.push(`  Author:     ${options.author}`);
  }
  if (options.maintainers && options.maintainers.length > 0) {
    lines.push(`  Maintainers: ${options.maintainers.join(', ')}`);
  }
  if (options.binCommand) {
    lines.push(`  Bin:        ${options.binCommand}`);
  }

  // Install scripts (dedicated field)
  if (options.installScripts && options.installScripts.length > 0) {
    lines.push(`  Scripts:    ${YELLOW}${options.installScripts.join(', ')}${RESET}`);
  } else {
    lines.push(`  Scripts:    ${GREEN}no install scripts${RESET}`);
  }

  // Permissions
  if (options.permissions) {
    const perms: string[] = [];
    if (options.permissions.fs) perms.push('filesystem');
    if (options.permissions.net) perms.push('network');
    if (options.permissions.childProcess) perms.push('child_process');
    if (options.permissions.env) perms.push('env');
    if (options.permissions.nativeAddon) perms.push('native_addon');
    if (perms.length > 0) {
      lines.push(`  Permissions: ${YELLOW}${perms.join(', ')}${RESET}`);
    } else {
      lines.push(`  Permissions: ${GREEN}none inferred${RESET}`);
    }
  }

  // Blockers
  if (report.blockers.length > 0) {
    lines.push('');
    lines.push(`${RED + BOLD}Blockers:${RESET}`);
    for (const b of report.blockers) {
      lines.push(`  ${SEVERITY_COLORS[b.severity] ?? RED}[${b.severity}]${RESET} ${b.code}: ${b.message}`);
      if (b.evidence.length > 0) {
        lines.push(`    ${DIM}evidence: ${b.evidence.join(', ')}${RESET}`);
      }
    }
  }

  // Warnings
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push(`${YELLOW}Warnings:${RESET}`);
    for (const w of report.warnings) {
      lines.push(`  ${SEVERITY_COLORS[w.severity] ?? DIM}[${w.severity}]${RESET} ${w.code}: ${w.message}`);
      if (w.evidence.length > 0) {
        lines.push(`    ${DIM}evidence: ${w.evidence.join(', ')}${RESET}`);
      }
    }
  }

  // Components
  if (report.components.length > 0) {
    lines.push('');
    lines.push(`${DIM}Score components:${RESET}`);
    for (const c of report.components) {
      if (c.contribution !== 0) {
        lines.push(`  ${c.component}: ${c.contribution < 0 ? RED : GREEN}${c.contribution}${RESET} ${DIM}(weight ${c.weight})${RESET}`);
      }
    }
  }

  return lines.join('\n');
}

/** Infer permissions from an AnalysisReport for TTY display. */
export function inferPermissions(report: AnalysisReport): InferredPermissions {
  return {
    fs: report.builtinsUsed.includes('fs'),
    net: report.builtinsUsed.some((b) => ['http', 'https', 'net', 'dns', 'dgram'].includes(b)),
    childProcess: report.builtinsUsed.includes('child_process'),
    env: report.staticFindings.some((f) => f.code === 'PROCESS_ENV_ACCESS' || f.code === 'SECRET_NAME_ACCESS'),
    nativeAddon: report.nativeArtifacts.length > 0,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export type { RiskReport, RiskFinding };
