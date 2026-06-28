/**
 * skill.md scanner (design 19).
 *
 * Parses Markdown files for npx/npm exec/pnpm dlx/yarn dlx/bunx commands
 * and runs preflight on each detected package.
 */
import { readFile } from 'node:fs/promises';

export interface DetectedCommand {
  /** The raw command line. */
  raw: string;
  /** Line number in the source file (1-based). */
  line: number;
  /** The tool that was detected (npx, npm exec, etc.). */
  tool: string;
  /** The package spec extracted from the command. */
  packageSpec: string;
  /** Package name (without version). */
  packageName: string;
  /** Optional version specifier. */
  version?: string;
}

export interface ScanResult {
  /** Path to the scanned file. */
  filePath: string;
  /** All detected commands. */
  commands: DetectedCommand[];
}

/**
 * Command patterns to detect.
 */
const COMMAND_PATTERNS: Array<{ tool: string; regex: RegExp }> = [
  { tool: 'npx', regex: /\bnpx\s+(.+)$/ },
  { tool: 'npm exec', regex: /\bnpm\s+exec\s+(.+)$/ },
  { tool: 'npm x', regex: /\bnpm\s+x\s+(.+)$/ },
  { tool: 'pnpm dlx', regex: /\bpnpm\s+dlx\s+(.+)$/ },
  { tool: 'yarn dlx', regex: /\byarn\s+dlx\s+(.+)$/ },
  { tool: 'bunx', regex: /\bbunx\s+(.+)$/ },
];

/**
 * Parse a Markdown file and extract shell commands from code blocks.
 */
export async function scanMarkdownFile(filePath: string): Promise<ScanResult> {
  const content = await readFile(filePath, 'utf8');
  const commands = parseMarkdownContent(content);
  return { filePath, commands };
}

/**
 * Parse Markdown content and extract commands.
 */
export function parseMarkdownContent(content: string): DetectedCommand[] {
  const commands: DetectedCommand[] = [];
  const lines = content.split('\n');
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Track code block boundaries.
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Only scan inside code blocks.
    if (!inCodeBlock) continue;

    // Try each command pattern.
    for (const { tool, regex } of COMMAND_PATTERNS) {
      const match = line.match(regex);
      if (match) {
        const packageSpec = cleanPackageSpec(match[1]!);
        const { name, version } = parsePackageSpec(packageSpec);
        commands.push({
          raw: line.trim(),
          line: lineNum,
          tool,
          packageSpec,
          packageName: name,
          version,
        });
        break; // Only one match per line.
      }
    }
  }

  return commands;
}

/**
 * Clean a package spec by removing shell escapes and flags.
 */
function cleanPackageSpec(spec: string): string {
  // Remove leading flags like --yes, -y, -p, --package repeatedly.
  let cleaned = spec;
  // Strip leading short and long flags (with optional values for --package=foo or --package foo).
  while (cleaned.length > 0) {
    const trimmed = cleaned.trimStart();
    if (trimmed.startsWith('--')) {
      const match = trimmed.match(/^--\S+/);
      if (!match) break;
      const flag = match[0]!;
      cleaned = trimmed.slice(flag.length);
      // If flag is --package or -p with separate value, skip the value too.
      if (flag === '--package' && cleaned.startsWith(' ')) {
        cleaned = cleaned.replace(/^\s+\S+/, '');
      }
      continue;
    }
    if (trimmed.startsWith('-') && !trimmed.startsWith('--')) {
      const match = trimmed.match(/^-\S+/);
      if (!match) break;
      const flag = match[0]!;
      cleaned = trimmed.slice(flag.length);
      // -p with separate value.
      if (flag === '-p' && cleaned.startsWith(' ')) {
        cleaned = cleaned.replace(/^\s+\S+/, '');
      }
      continue;
    }
    cleaned = trimmed;
    break;
  }
  // Remove trailing shell operators and everything after.
  cleaned = cleaned.replace(/[&|;`$()].*$/, '');
  // Remove quotes.
  cleaned = cleaned.replace(/^['"]|['"]$/g, '');
  // Take only the first token (the package spec).
  cleaned = cleaned.trim().split(/\s+/)[0] ?? '';
  return cleaned;
}

/**
 * Parse a package spec into name and version.
 * Examples: "pkg@1.0.0" → { name: "pkg", version: "1.0.0" }
 *           "@scope/pkg@latest" → { name: "@scope/pkg", version: "latest" }
 *           "pkg" → { name: "pkg", version: undefined }
 */
export function parsePackageSpec(spec: string): { name: string; version?: string } {
  // Handle scoped packages: @scope/pkg@version
  if (spec.startsWith('@')) {
    const lastAt = spec.lastIndexOf('@');
    if (lastAt === 0) {
      // No version, just @scope/pkg.
      return { name: spec };
    }
    return {
      name: spec.slice(0, lastAt),
      version: spec.slice(lastAt + 1),
    };
  }

  // Non-scoped: pkg@version
  const atIdx = spec.indexOf('@');
  if (atIdx === -1) {
    return { name: spec };
  }
  return {
    name: spec.slice(0, atIdx),
    version: spec.slice(atIdx + 1),
  };
}

/**
 * Deduplicate commands by package spec.
 */
export function deduplicateCommands(commands: DetectedCommand[]): DetectedCommand[] {
  const seen = new Set<string>();
  const result: DetectedCommand[] = [];
  for (const cmd of commands) {
    const key = cmd.packageSpec;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(cmd);
    }
  }
  return result;
}
