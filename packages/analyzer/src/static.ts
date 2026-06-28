import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acorn from 'acorn';
import type { RiskFinding, AnalysisReport, Permissions } from '@safe-npm/core-types';

const SENSITIVE_MODULES: Record<string, string> = {
  fs: 'fs',
  'node:fs': 'fs',
  child_process: 'child_process',
  'node:child_process': 'child_process',
  http: 'http',
  'node:http': 'http',
  https: 'https',
  'node:https': 'https',
  net: 'net',
  'node:net': 'net',
  dns: 'dns',
  'node:dns': 'dns',
  dgram: 'dgram',
  'node:dgram': 'dgram',
  os: 'os',
  'node:os': 'os',
  crypto: 'crypto',
  'node:crypto': 'crypto',
};

const SECRET_NAMES: Record<string, true> = {
  GITHUB_TOKEN: true,
  GH_TOKEN: true,
  NPM_TOKEN: true,
  NPM_AUTHTOKEN: true,
  AWS_ACCESS_KEY_ID: true,
  AWS_SECRET_ACCESS_KEY: true,
  STRIPE_SECRET_KEY: true,
  DATABASE_URL: true,
  PRIVATE_KEY: true,
  API_KEY: true,
  SECRET: true,
  PASSWORD: true,
  TOKEN: true,
};

export interface StaticFindingContext {
  file: string;
  line: number;
}

export interface StaticAnalysisResult {
  findings: RiskFinding[];
  inferredPermissions: Permissions;
}

/**
 * Statically analyze a list of code files for risky APIs without executing them.
 * Uses acorn for AST parsing where possible; falls back to regex scanning.
 */
export async function analyzeStaticFiles(
  pkgRoot: string,
  codeFiles: string[],
): Promise<StaticAnalysisResult> {
  const findings: RiskFinding[] = [];
  const importedModules = new Set<string>();
  let processEnvAccess = false;
  const secretAccess: string[] = [];
  let evalUsed = false;
  let newFunctionUsed = false;
  let dynamicImportUsed = false;
  let base64EvalUsed = false;

  for (const rel of codeFiles) {
    let source: string;
    try {
      source = await readFile(join(pkgRoot, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = source.split('\n');

    // AST parse for imports/eval/Function/dynamic-import.
    let ast: acorn.Program | null = null;
    try {
      ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowReturnOutsideFunction: true,
      }) as acorn.Program;
    } catch {
      // fall back to regex scanning below; emit a low-severity parse finding
      findings.push({
        code: 'PARSE_FAILED',
        severity: 'low',
        message: `Could not parse ${rel}; used regex fallback.`,
        evidence: [rel],
      });
    }

    if (ast) {
      walkAst(ast, (node) => {
        // import declarations
        if (node.type === 'ImportDeclaration') {
          const src = getStringValue(node.source);
          if (src) importedModules.add(src);
        }
        // require calls
        if (node.type === 'CallExpression' && getCalleeName(node.callee) === 'require') {
          const args = node.arguments;
          if (Array.isArray(args)) {
            const arg = asRec(args[0]);
            if (arg?.type === 'Literal' && typeof arg.value === 'string') {
              importedModules.add(arg.value);
            }
          }
        }
        // eval
        if (node.type === 'CallExpression' && getCalleeName(node.callee) === 'eval') {
          evalUsed = true;
          findings.push({
            code: 'EVAL_USED',
            severity: 'high',
            message: 'eval() usage detected.',
            evidence: [`${rel}:${lineOf(node)}`],
          });
        }
        // new Function
        if (node.type === 'NewExpression' && getCalleeName(node.callee) === 'Function') {
          newFunctionUsed = true;
          findings.push({
            code: 'NEW_FUNCTION_USED',
            severity: 'high',
            message: 'new Function() usage detected.',
            evidence: [`${rel}:${lineOf(node)}`],
          });
        }
        // dynamic import with non-literal
        if (node.type === 'ImportExpression') {
          const src = asRec(node.source);
          if (!src || src.type !== 'Literal') {
            dynamicImportUsed = true;
            findings.push({
              code: 'DYNAMIC_IMPORT',
              severity: 'medium',
              message: 'dynamic import() with non-literal argument.',
              evidence: [`${rel}:${lineOf(node)}`],
            });
          }
        }
        // process.env access
        if (node.type === 'MemberExpression') {
          const obj = asRec(node.object);
          if (
            obj?.type === 'MemberExpression' &&
            getCalleeName(obj.object) === 'process' &&
            getPropertyKey(obj) === 'env'
          ) {
            processEnvAccess = true;
            const key = getPropertyKey(node);
            if (key && SECRET_NAMES[key] === true) {
              secretAccess.push(key);
              findings.push({
                code: 'SECRET_ENV_ACCESS',
                severity: 'high',
                message: `reads process.env.${key}`,
                evidence: [`${rel}:${lineOf(node)}`],
              });
            }
          }
        }
      });
    }

    // Regex fallback for process.env / base64+eval (covers parse failures).
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      if (!ast && /\bprocess\.env\b/.test(line)) {
        processEnvAccess = true;
        const m = line.match(/process\.env\.([A-Z0-9_]+)/);
        const key = m?.[1];
        if (key && SECRET_NAMES[key] === true) {
          secretAccess.push(key);
          findings.push({
            code: 'SECRET_ENV_ACCESS',
            severity: 'high',
            message: `reads process.env.${key}`,
            evidence: [`${rel}:${i + 1}`],
          });
        }
      }
      // base64 decode followed by eval/function/spawn
      if (/atob\s*\(|Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/.test(line)) {
        const window = lines.slice(i, Math.min(i + 6, lines.length)).join('\n');
        if (/\beval\s*\(|new\s+Function\s*\(|\.exec\s*\(|spawn\s*\(/.test(window)) {
          base64EvalUsed = true;
          findings.push({
            code: 'BASE64_DECODED_EXEC',
            severity: 'critical',
            message: 'base64-decoded payload passed to eval/Function/exec/spawn.',
            evidence: [`${rel}:${i + 1}`],
          });
        }
      }
    }
  }

  // Map imported sensitive modules to findings.
  for (const mod of importedModules) {
    const mapped = SENSITIVE_MODULES[mod];
    if (mapped) {
      const severity = severityForModule(mapped);
      findings.push({
        code: `MODULE_${mapped.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
        severity,
        message: `imports ${mod}`,
        evidence: [],
      });
    }
  }

  if (processEnvAccess && secretAccess.length === 0) {
    findings.push({
      code: 'PROCESS_ENV_ACCESS',
      severity: 'low',
      message: 'reads process.env',
      evidence: [],
    });
  }

  const inferredPermissions = inferPermissions(importedModules, {
    evalUsed,
    newFunctionUsed,
    dynamicImportUsed,
    base64EvalUsed,
  });

  return { findings, inferredPermissions };
}

function severityForModule(mod: string): 'low' | 'medium' | 'high' {
  if (mod === 'child_process') return 'high';
  if (mod === 'fs' || mod === 'http' || mod === 'https' || mod === 'net') return 'medium';
  return 'low';
}
function inferPermissions(
  importedModules: Set<string>,
  _flags: {
    evalUsed: boolean;
    newFunctionUsed: boolean;
    dynamicImportUsed: boolean;
    base64EvalUsed: boolean;
  },
): Permissions {
  const has = (m: string) => importedModules.has(m) || importedModules.has(`node:${m}`);
  return {
    fs: has('fs') ? { read: ['.'], write: ['.'] } : undefined,
    net: has('http') || has('https') || has('net') || has('dns') || has('dgram') ? ['*'] : [],
    env: [],

    childProcess: has('child_process'),
    workerThreads: false,
    ffi: false,
    native: false,
    installScripts: false,
  };
}

// Minimal AST walker over loosely-typed acorn nodes.
type Rec = Record<string, unknown> & { type: string };

function asRec(node: unknown): Rec | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const r = node as Rec;
  return typeof r.type === 'string' ? r : undefined;
}

function walkAst(node: unknown, visit: (n: Rec) => void): void {
  const r = asRec(node);
  if (!r) return;
  visit(r);
  for (const key of Object.keys(r)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = r[key];
    if (Array.isArray(child)) {
      for (const c of child) walkAst(c, visit);
    } else {
      walkAst(child, visit);
    }
  }
}

function lineOf(node: Rec): number {
  const loc = node.loc as { start?: { line?: number } } | undefined;
  return loc?.start?.line ?? 1;
}

function getCalleeName(callee: unknown): string | undefined {
  const r = asRec(callee);
  if (r?.type === 'Identifier' && typeof r.name === 'string') return r.name;
  return undefined;
}

function getStringValue(node: unknown): string | undefined {
  const r = asRec(node);
  if (r?.type === 'Literal' && typeof r.value === 'string') return r.value;
  return undefined;
}

function getPropertyKey(node: unknown): string | undefined {
  const r = asRec(node);
  if (!r || r.type !== 'MemberExpression') return undefined;
  const prop = asRec(r.property);
  if (!prop) return undefined;
  if (!r.computed && prop.type === 'Identifier' && typeof prop.name === 'string') return prop.name;
  if (r.computed && prop.type === 'Literal' && typeof prop.value === 'string') return prop.value;
  return undefined;
}

/** Apply static analysis results to an AnalysisReport. */
export function applyStaticAnalysis(
  report: AnalysisReport,
  result: StaticAnalysisResult,
): void {
  report.staticFindings = result.findings;
  report.inferredPermissions = result.inferredPermissions;
}
