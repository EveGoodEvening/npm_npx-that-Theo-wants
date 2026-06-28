import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acorn from 'acorn';
import { simple as walkSimple, base as walkBase } from 'acorn-walk';
import {
  NodeBuiltin,
  StaticFinding,
  StaticFindingCode,
  type NodeBuiltin as NodeBuiltinType,
  type StaticFinding as StaticFindingType,
} from '@safe-npm/core-types';

/**
 * Static JS/TS analyzer MVP (design 4.5 / 10.2). Parses JS/MJS/CJS files (and
 * best-effort TS/TSX) with acorn and flags risky APIs without executing code.
 *
 * Parse failures do not abort the whole analysis; a `PARSE_FAILURE` finding is
 * emitted with reduced confidence.
 */

const PARSEABLE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);

const SECRET_NAME_PATTERNS = [
  /TOKEN/i,
  /SECRET/i,
  /API[_-]?KEY/i,
  /PASSWORD/i,
  /PASSWD/i,
  /PRIVATE[_-]?KEY/i,
  /AWS[_-]?(ACCESS|SECRET)/i,
  /GITHUB/i,
  /STRIPE/i,
  /CREDENTIAL/i,
];

export interface StaticAnalysisOptions {
  /** Root directory to walk. */
  root: string;
  /** Relative file paths to analyze (under root). */
  files: string[];
}

export interface StaticAnalysisResult {
  findings: StaticFindingType[];
  builtinsUsed: NodeBuiltinType[];
}

export async function analyzeStaticFiles(
  root: string,
  files: string[],
): Promise<StaticAnalysisResult> {
  const findings: StaticFindingType[] = [];
  const builtins = new Set<NodeBuiltinType>();

  for (const file of files) {
    if (!PARSEABLE_EXTENSIONS.has(ext(file))) continue;
    const abs = join(root, file);
    let source: string;
    try {
      source = await readFile(abs, 'utf8');
    } catch {
      continue;
    }
    analyzeSource(source, file, findings, builtins);
  }

  return { findings, builtinsUsed: [...builtins] };
}

function ext(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

function analyzeSource(
  source: string,
  file: string,
  findings: StaticFindingType[],
  builtins: Set<NodeBuiltinType>,
): void {
  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch {
    // Fallback: try CommonJS sourceType, then give up with a finding.
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        allowReturnOutsideFunction: true,
        locations: true,
      });
    } catch (err) {
      findings.push(
        StaticFinding.parse({
          code: 'PARSE_FAILURE',
          file,
          evidence: err instanceof Error ? err.message.slice(0, 200) : 'parse error',
          confidence: 0.5,
        }),
      );
      // Best-effort regex sweep for high-value signals even when parsing fails.
      regexFallback(source, file, findings, builtins);
      return;
    }
  }

  const walker = new Walker(file, findings, builtins);
  walkSimple(ast, walker.visitors(), walkBase);
}

class Walker {
  constructor(
    private readonly file: string,
    private readonly findings: StaticFindingType[],
    private readonly builtins: Set<NodeBuiltinType>,
  ) {}

  visitors(): Record<string, (node: unknown, state?: unknown) => void> {
    return {
      ImportDeclaration: (node) => this.visitImport(node as acorn.ImportDeclaration),
      CallExpression: (node) => this.visitCall(node as acorn.CallExpression),
      NewExpression: (node) => this.visitNew(node as acorn.NewExpression),
      MemberExpression: (node) => this.visitMember(node as acorn.MemberExpression),
      ImportExpression: (node) => this.visitImportExpression(node as acorn.ImportExpression),
    };
  }

  private add(code: StaticFindingCode, line?: number, evidence?: string, confidence = 1): void {
    this.findings.push(
      StaticFinding.parse({
        code,
        file: this.file,
        ...(line ? { line } : {}),
        ...(evidence ? { evidence } : {}),
        confidence,
      }),
    );
  }

  private visitImport(node: acorn.ImportDeclaration): void {
    const src = node.source;
    if (src?.type === 'Literal' && typeof src.value === 'string') {
      this.recordBuiltin(src.value, src.loc?.start.line);
    }
  }

  private visitCall(node: acorn.CallExpression): void {
    const callee = node.callee;
    // require('fs')
    if (callee.type === 'Identifier' && callee.name === 'require') {
      const arg = node.arguments[0];
      if (arg?.type === 'Literal' && typeof arg.value === 'string') {
        this.recordBuiltin(arg.value, arg.loc?.start.line);
      }
    }
    // eval(...)
    if (callee.type === 'Identifier' && callee.name === 'eval') {
      this.add('EVAL', node.loc?.start.line, 'eval() call');
    }
    // import('...') is an ImportExpression handled separately; dynamic import
    // with non-literal arg is handled in visitImportExpression.
    // Buffer.from(x, 'base64') near exec — heuristic: flag base64 decode usage.
    if (
      callee.type === 'MemberExpression' &&
      callee.object.type === 'Identifier' &&
      callee.object.name === 'Buffer' &&
      callee.property.type === 'Identifier' &&
      callee.property.name === 'from'
    ) {
      const args = node.arguments;
      if (args.length >= 2 && args[1]?.type === 'Literal' && args[1]?.value === 'base64') {
        this.add('BASE64_DECODE_EXEC', node.loc?.start.line, 'Buffer.from(..., "base64")', 0.6);
      }
    }
  }

  private visitNew(node: acorn.NewExpression): void {
    const callee = node.callee;
    if (callee.type === 'Identifier' && callee.name === 'Function') {
      this.add('NEW_FUNCTION', node.loc?.start.line, 'new Function(...)');
    }
  }

  private visitMember(node: acorn.MemberExpression): void {
    // process.env.X
    if (
      node.object.type === 'MemberExpression' &&
      node.object.object.type === 'Identifier' &&
      node.object.object.name === 'process' &&
      node.object.property.type === 'Identifier' &&
      node.object.property.name === 'env'
    ) {
      const line = node.loc?.start.line;
      this.add('PROCESS_ENV_ACCESS', line, 'process.env access');
      const prop = node.property;
      const name =
        prop.type === 'Identifier' ? prop.name : prop.type === 'Literal' ? String(prop.value) : '';
      if (name && SECRET_NAME_PATTERNS.some((re) => re.test(name))) {
        this.add('SECRET_NAME_ACCESS', line, `process.env.${name}`);
      }
    }
  }

  private visitImportExpression(node: acorn.ImportExpression): void {
    const arg = node.source ?? (node as unknown as { source?: acorn.Expression }).source;
    if (!arg) return;
    if (arg.type !== 'Literal') {
      this.add('DYNAMIC_IMPORT_NONLITERAL', node.loc?.start.line, 'import(<non-literal>)');
    } else if (typeof arg.value === 'string') {
      this.recordBuiltin(arg.value, arg.loc?.start.line);
    }
  }

  private recordBuiltin(spec: string, line?: number): void {
    const builtin = builtinOf(spec);
    if (!builtin) return;
    this.builtins.add(builtin);
    this.add(builtinCode(builtin), line, `import/require "${spec}"`);
  }
}

function builtinOf(spec: string): NodeBuiltinType | null {
  const stripped = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (stripped.includes('/')) {
    const top = stripped.split('/')[0]!;
    if (top === 'fs' || top === 'child_process') return top as NodeBuiltinType;
  }
  if (NodeBuiltin.safeParse(stripped).success) return stripped as NodeBuiltinType;
  return null;
}

function builtinCode(b: NodeBuiltinType): StaticFindingCode {
  const map: Partial<Record<NodeBuiltinType, StaticFindingCode>> = {
    fs: 'BUILTIN_FS',
    child_process: 'BUILTIN_CHILD_PROCESS',
    http: 'BUILTIN_HTTP',
    https: 'BUILTIN_HTTPS',
    net: 'BUILTIN_NET',
    dns: 'BUILTIN_DNS',
    dgram: 'BUILTIN_DGRAM',
    os: 'BUILTIN_OS',
    crypto: 'BUILTIN_CRYPTO',
  };
  return map[b] ?? 'BUILTIN_FS';
}

function regexFallback(
  source: string,
  file: string,
  findings: StaticFindingType[],
  builtins: Set<NodeBuiltinType>,
): void {
  const requireRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = requireRe.exec(source))) {
    const b = builtinOf(m[1]!);
    if (b) {
      builtins.add(b);
      findings.push(StaticFinding.parse({ code: builtinCode(b), file, evidence: `require("${m[1]}")`, confidence: 0.7 }));
    }
  }
  if (/\beval\s*\(/.test(source)) {
    findings.push(StaticFinding.parse({ code: 'EVAL', file, evidence: 'eval(', confidence: 0.7 }));
  }
  if (/process\.env\.[A-Z0-9_]+/i.test(source)) {
    findings.push(StaticFinding.parse({ code: 'PROCESS_ENV_ACCESS', file, evidence: 'process.env', confidence: 0.7 }));
  }
}
