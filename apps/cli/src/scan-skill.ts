import { readFile } from 'node:fs/promises';
import { parsePackageSpec } from '@safe-npm/npm-compat';

/** A detected package-execution command in a Markdown file. */
export interface DetectedCommand {
  line: number;
  raw: string;
  /** Detected tool name (npx, npm exec, npm x, pnpm dlx, yarn dlx, bunx). */
  tool: string;
  /** Parsed package name (may include @scope). */
  package: string;
  /** Specifier (version/range/dist-tag) if present. */
  specifier?: string;
  /** Full package spec reconstructed for preflight. */
  spec: string;
}


const TOOL_PATTERNS: Array<{ tool: string; re: RegExp }> = [
  // npx <pkg>  (name may be @scope/name; optional @specifier after name)
  { tool: 'npx', re: /\bnpx\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
  // npm exec <pkg>
  { tool: 'npm exec', re: /\bnpm\s+exec\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
  // npm x <pkg>
  { tool: 'npm x', re: /\bnpm\s+x\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
  // pnpm dlx <pkg>
  { tool: 'pnpm dlx', re: /\bpnpm\s+dlx\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
  // yarn dlx <pkg>
  { tool: 'yarn dlx', re: /\byarn\s+dlx\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
  // bunx <pkg>
  { tool: 'bunx', re: /\bbunx\s+(@[\w./-]+\/[\w./-]+|[\w./-]+)(?:@([^\s;&|]+))?/ },
];
/**
 * Parse a Markdown file and extract package-execution commands from shell
 * code blocks. Detects npx, npm exec, npm x, pnpm dlx, yarn dlx, bunx.
 * Does not execute anything.
 */
export async function scanSkillFile(filePath: string): Promise<{ file: string; commands: DetectedCommand[] }> {
  const content = await readFile(filePath, 'utf8');
  return { file: filePath, commands: scanSkillMarkdown(content) };
}

/** Scan Markdown content (string) for package-execution commands. */
export function scanSkillMarkdown(content: string): DetectedCommand[] {
  const commands: DetectedCommand[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;
  let codeBlockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockStartLine = i + 1;
      }
      continue;
    }
    if (!inCodeBlock) continue;
    // skip comments and non-command lines
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) continue;

    for (const { tool, re } of TOOL_PATTERNS) {
      const m = re.exec(line);
      if (!m) continue;
      const pkg = m[1];
      const specifier = m[2];
      if (!pkg) continue;
      // strip leading -- flags accidentally captured
      if (pkg.startsWith('-')) continue;
      const spec = specifier ? `${pkg}@${specifier}` : pkg;
      commands.push({
        line: i + 1,
        raw: trimmed,
        tool,
        package: pkg,
        specifier,
        spec,
      });
      break; // one tool per line
    }
  }
  // codeBlockStartLine unused but kept for future line-offset reporting
  void codeBlockStartLine;
  return commands;
}

export interface ScanResult {
  file: string;
  commands: Array<DetectedCommand & {
    resolvedVersion?: string;
    decision: 'allow' | 'requires_approval' | 'blocked';
    reason?: string;
  }>;
}

export interface ScanPreflightFn {
  (spec: string): Promise<{ decision: 'allow' | 'requires_approval' | 'blocked'; reason?: string; resolvedVersion?: string }>;
}

/**
 * Scan a skill file and run preflight on each detected package command.
 * Deduplicates by spec. Does not execute anything.
 */
export async function scanAndPreflight(filePath: string, preflight: ScanPreflightFn): Promise<ScanResult> {
  const { file, commands } = await scanSkillFile(filePath);
  const seen = new Set<string>();
  const results: ScanResult['commands'] = [];
  for (const cmd of commands) {
    if (seen.has(cmd.spec)) continue;
    seen.add(cmd.spec);
    try {
      const pf = await preflight(cmd.spec);
      results.push({ ...cmd, resolvedVersion: pf.resolvedVersion, decision: pf.decision, reason: pf.reason });
    } catch (err) {
      results.push({
        ...cmd,
        decision: 'blocked',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { file, commands: results };
}

/** Compute the aggregate exit code for a scan result per design §19.3. */
export function scanExitCode(result: ScanResult): number {
  if (result.commands.some((c) => c.decision === 'blocked')) return 11;
  if (result.commands.some((c) => c.decision === 'requires_approval')) return 10;
  return 0;
}

/** Validate a detected spec parses (used to filter malformed commands). */
export function isValidPackageSpec(spec: string): boolean {
  try {
    parsePackageSpec(spec);
    return true;
  } catch {
    return false;
  }
}
