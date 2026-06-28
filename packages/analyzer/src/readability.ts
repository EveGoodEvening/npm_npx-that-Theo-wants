import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acorn from 'acorn';
import type { AnalysisReport } from '@safe-npm/core-types';

export interface ReadabilityResult {
  likelyMinified: boolean;
  likelyObfuscated: boolean;
  sourceMapsPresent: boolean;
  humanReadableFileRatio: number;
  minifiedLineRatio: number;
  averageIdentifierLength?: number;
}

/**
 * Compute readability/obfuscation facts for a set of code files.
 * Does not execute any code.
 */
export async function analyzeReadability(
  pkgRoot: string,
  codeFiles: string[],
  sourceMapsPresent: boolean,
): Promise<ReadabilityResult> {
  let totalLines = 0;
  let minifiedLines = 0;
  let readableFiles = 0;
  const identifierLengths: number[] = [];
  let highEntropyStrings = 0;
  let giantStringArrays = 0;

  for (const rel of codeFiles) {
    let source: string;
    try {
      source = await readFile(join(pkgRoot, rel), 'utf8');
    } catch {
      continue;
    }
    const lines = source.split('\n');
    totalLines += lines.length;

    let fileMinifiedLines = 0;
    for (const line of lines) {
      // minified heuristic: very long line with many statements
      if (line.length > 500 && (line.match(/[;{}]/g)?.length ?? 0) > 5) {
        fileMinifiedLines++;
      }
    }
    minifiedLines += fileMinifiedLines;

    // Try AST parse for identifier stats.
    try {
      const ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowReturnOutsideFunction: true,
      }) as acorn.Node;
      const ids: string[] = [];
      collectIdentifiers(ast, ids);
      for (const id of ids) identifierLengths.push(id.length);
      // collect long string literals and flag high-entropy ones
      const longStrings: string[] = [];
      collectLongStrings(ast, longStrings);
      for (const s of longStrings) {
        if (s.length >= 40 && shannonEntropy(s) > 4.5) highEntropyStrings++;
      }
      // giant string array: a single ArrayExpression of > 50 string literals
      if (hasGiantStringArray(ast)) giantStringArrays++;
    } catch {
      // parse failure: treat as not-readable
    }

    // human-readable heuristic: avg line length reasonable and few minified lines
    const avgLineLen = source.length / Math.max(lines.length, 1);
    if (fileMinifiedLines === 0 && avgLineLen < 120) readableFiles++;
  }

  const minifiedLineRatio = totalLines > 0 ? minifiedLines / totalLines : 0;
  const humanReadableFileRatio = codeFiles.length > 0 ? readableFiles / codeFiles.length : 1;
  const averageIdentifierLength =
    identifierLengths.length > 0
      ? identifierLengths.reduce((a, b) => a + b, 0) / identifierLengths.length
      : undefined;

  const likelyMinified = minifiedLineRatio > 0.3 || humanReadableFileRatio < 0.5;
  const likelyObfuscated =
    (averageIdentifierLength !== undefined && averageIdentifierLength < 2.5) ||
    giantStringArrays > 0 ||
    highEntropyStrings > 0;

  return {
    likelyMinified,
    likelyObfuscated,
    sourceMapsPresent,
    humanReadableFileRatio,
    minifiedLineRatio,
    averageIdentifierLength,
  };
}

function collectIdentifiers(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'Identifier' && typeof n.name === 'string') {
    out.push(n.name as string);
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = n[key];
    if (Array.isArray(child)) {
      for (const c of child) collectIdentifiers(c, out);
    } else {
      collectIdentifiers(child, out);
    }
  }
}

function hasGiantStringArray(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = node as Record<string, unknown>;
  if (n.type === 'ArrayExpression') {
    const elements = n.elements as unknown[];
    const stringCount = elements.filter(
      (e) => e && typeof e === 'object' && (e as Record<string, unknown>).type === 'Literal' &&
        typeof (e as Record<string, unknown>).value === 'string',
    ).length;
    if (stringCount > 50) return true;
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = n[key];
    if (Array.isArray(child)) {
      for (const c of child) if (hasGiantStringArray(c)) return true;
    } else if (hasGiantStringArray(child)) {
      return true;
    }
  }
  return false;
}

function collectLongStrings(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  const n = node as Record<string, unknown>;
  if (n.type === 'Literal' && typeof n.value === 'string' && (n.value as string).length >= 40) {
    out.push(n.value as string);
  }
  for (const key of Object.keys(n)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const child = n[key];
    if (Array.isArray(child)) {
      for (const c of child) collectLongStrings(c, out);
    } else {
      collectLongStrings(child, out);
    }
  }
}

/** Shannon entropy in bits per character for a string. */
function shannonEntropy(s: string): number {
  const counts: Record<string, number> = {};
  for (const ch of s) {
    counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const len = s.length;
  let entropy = 0;
  for (const ch of Object.keys(counts)) {
    const p = counts[ch]! / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Apply readability results to an AnalysisReport. */
export function applyReadability(report: AnalysisReport, result: ReadabilityResult): void {
  report.readability = {
    likelyMinified: result.likelyMinified,
    likelyObfuscated: result.likelyObfuscated,
    sourceMapsPresent: result.sourceMapsPresent,
    humanReadableFileRatio: result.humanReadableFileRatio,
    minifiedLineRatio: result.minifiedLineRatio,
    averageIdentifierLength: result.averageIdentifierLength,
  };
}
