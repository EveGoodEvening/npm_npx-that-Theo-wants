import type { RiskReport, AnalysisReport } from '@safe-npm/core-types';
/** Render a risk report as stable JSON. */
export function renderJson(report: RiskReport): string {
  return JSON.stringify(report, null, 2);
}

/** Render a human-readable TTY risk card per design §12.1. */
export function renderTty(report: RiskReport, analysis?: AnalysisReport): string {
  const lines: string[] = [];
  lines.push(`Package: ${report.package}@${report.version}`);
  lines.push('');
  if (analysis) {
    const binEntries = Object.keys(analysis.package.bin);
    if (binEntries.length > 0) {
      lines.push(`Bin:        ${binEntries.join(', ')}`);
    }
    if (analysis.lifecycleScripts.length > 0) {
      lines.push(`Scripts:    ${analysis.lifecycleScripts.join(', ')}`);
    }
    if (analysis.package.maintainers.length > 0) {
      lines.push(`Maintainers: ${analysis.package.maintainers.join(', ')}`);
    }
    if (analysis.package.author) {
      lines.push(`Author:     ${analysis.package.author}`);
    }
    lines.push('');
  }
  const t = report.facts.tarball;
  lines.push('Tarball');
  lines.push(`  Size:       ${formatBytes(t.sizeBytes)} / ${formatBytes(t.unpackedSizeBytes)} unpacked / ${t.fileCount} files`);
  if (report.facts.permissions) {
    const p = report.facts.permissions;
    lines.push('Permissions');
    lines.push(`  Declared:   ${describePermissions(p.declared)}`);
    lines.push(`  Inferred:   ${describePermissions(p.inferred)}`);
    lines.push(`  Enforceable: ${p.enforceable ? 'yes' : 'no'}`);
  }
  if (report.facts.publisher) {
    const pub = report.facts.publisher;
    lines.push('Publisher');
    lines.push(`  Name:       ${pub.name ?? 'unknown'}`);
    lines.push(`  Trusted:    ${pub.trustedPublisher ? 'yes' : 'no'}`);
    lines.push(`  Strong auth: ${pub.strongAuth ? 'yes' : 'no'}`);
  }
  if (report.facts.source) {
    const s = report.facts.source;
    lines.push('Source');
    lines.push(`  Repository: ${s.repository ?? 'missing'}`);
    lines.push(`  Provenance: ${s.provenance}`);
    if (s.commit) lines.push(`  Commit:     ${s.commit}`);
  }
  lines.push('Security');
  lines.push(`  Score:      ${report.score}/100 ${report.tier}`);
  lines.push(`  Confidence: ${report.confidence}/100`);
  lines.push(`  Blockers:   ${report.blockers.length}`);
  lines.push(`  Warnings:   ${report.warnings.length}`);
  if (report.blockers.length > 0) {
    lines.push('');
    lines.push('Blockers:');
    for (const b of report.blockers) {
      lines.push(`  [${b.severity}] ${b.code}: ${b.message}`);
    }
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of report.warnings) {
      lines.push(`  [${w.severity}] ${w.code}: ${w.message}`);
    }
  }
  if (report.components.length > 0) {
    lines.push('');
    lines.push('Score components:');
    for (const c of report.components) {
      lines.push(`  ${c.name}: ${c.contribution} (weight ${c.weight})`);
    }
  }
  return lines.join('\n');
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function describePermissions(p: {
  fs?: { read: string[]; write: string[] };
  net: string[];
  childProcess: boolean;
  native: boolean;
  installScripts: boolean;
}): string {
  const parts: string[] = [];
  parts.push(`fs ${p.fs ? `read=${p.fs.read.join(',') || '-'}` : '-'}`);
  parts.push(`net ${p.net.length > 0 ? p.net.join(',') : 'none'}`);
  parts.push(`child_process ${p.childProcess}`);
  parts.push(`native ${p.native}`);
  parts.push(`installScripts ${p.installScripts}`);
  return parts.join(', ');
}
