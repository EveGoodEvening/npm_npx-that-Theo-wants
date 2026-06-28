import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as acorn from 'acorn';
import { ReadabilityFacts, type ReadabilityFacts as ReadabilityFactsType } from '@safe-npm/core-types';

/**
 * Obfuscation / readability analyzer (design 4.6). Computes minified-line
 * ratio, average identifier length, string entropy, source-map presence, and
 * produces readability facts. Never executes package code.
 */

const CODE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const MINIFIED_LINE_THRESHOLD = 200; // chars per non-empty line considered "minified"
const GIANT_STRING_ARRAY_THRESHOLD = 100; // entries in a single string array
const HIGH_ENTROPY_THRESHOLD = 4.5; // bits/char for long strings

export interface ReadabilityInput {
  root: string;
  files: string[];
}

export async function analyzeReadability(root: string, files: string[]): Promise<ReadabilityFactsType> {
  let codeFiles = 0;
  let minifiedFiles = 0;
  let humanReadableFiles = 0;
  let totalNonEmptyLines = 0;
  let totalMinifiedLines = 0;
  const identifierLengths: number[] = [];
  let maxEntropy = 0;
  let giantStringArrays = false;

  for (const file of files) {
    if (!CODE_EXTENSIONS.has(ext(file))) continue;
    codeFiles++;
    const abs = join(root, file);
    let source: string;
    try {
      source = await readFile(abs, 'utf8');
    } catch {
      continue;
    }

    const lines = source.split(/\r?\n/);
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    totalNonEmptyLines += nonEmpty.length;
    const minifiedLines = nonEmpty.filter((l) => l.length >= MINIFIED_LINE_THRESHOLD).length;
    totalMinifiedLines += minifiedLines;

    const entropy = maxStringEntropy(source);
    if (entropy > maxEntropy) maxEntropy = entropy;

    // Try to parse and gather identifier lengths + string arrays.
    let parsed = false;
    try {
      const ast = acorn.parse(source, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowReturnOutsideFunction: true,
      });
      const idents: number[] = [];
      let giantArray = false;
      collectIdentifiersAndArrays(ast, idents, (count) => {
        if (count >= GIANT_STRING_ARRAY_THRESHOLD) giantArray = true;
      });
      identifierLengths.push(...idents);
      if (giantArray) giantStringArrays = true;
      parsed = true;
    } catch {
      try {
        const ast = acorn.parse(source, {
          ecmaVersion: 'latest',
          sourceType: 'script',
          allowReturnOutsideFunction: true,
        });
        const idents: number[] = [];
        collectIdentifiersAndArrays(ast, idents, (count) => {
          if (count >= GIANT_STRING_ARRAY_THRESHOLD) giantStringArrays = true;
        });
        identifierLengths.push(...idents);
        parsed = true;
      } catch {
        // unparseable; treat as not-human-readable signal
      }
    }

    const isMinified = minifiedLines > 0 && minifiedLines / Math.max(nonEmpty.length, 1) > 0.5;
    if (isMinified) {
      minifiedFiles++;
    } else if (parsed) {
      humanReadableFiles++;
    }
  }

  const sourceMapsPresent = files.some((f) => f.endsWith('.js.map') || f.endsWith('.map'));
  const minifiedLineRatio = totalNonEmptyLines > 0 ? totalMinifiedLines / totalNonEmptyLines : 0;
  const humanReadableFileRatio = codeFiles > 0 ? humanReadableFiles / codeFiles : 1;
  const averageIdentifierLength =
    identifierLengths.length > 0
      ? identifierLengths.reduce((a, b) => a + b, 0) / identifierLengths.length
      : undefined;
  const likelyMinified = minifiedFiles > 0 && minifiedFiles / Math.max(codeFiles, 1) >= 0.5;
  const likelyObfuscated =
    (averageIdentifierLength !== undefined && averageIdentifierLength < 2) ||
    giantStringArrays ||
    maxEntropy >= HIGH_ENTROPY_THRESHOLD;

  return ReadabilityFacts.parse({
    likelyMinified,
    likelyObfuscated,
    sourceMapsPresent,
    humanReadableFileRatio,
    minifiedLineRatio,
    ...(averageIdentifierLength !== undefined ? { averageIdentifierLength } : {}),
    ...(maxEntropy > 0 ? { maxStringEntropy: maxEntropy } : {}),
    giantStringArrays,
  });
}

function ext(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i).toLowerCase();
}

/** Shannon entropy (bits/char) of the longest string literal in `source`. */
function maxStringEntropy(source: string): number {
  const strings: string[] = [];
  const re = /'([^'\\]|\\.){20,}'|"([^"\\]|\\.){20,}"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    strings.push(m[0]);
  }
  let max = 0;
  for (const s of strings) {
    const e = entropy(s);
    if (e > max) max = e;
  }
  return max;
}

function entropy(s: string): number {
  if (s.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function collectIdentifiersAndArrays(
  ast: acorn.Program,
  idents: number[],
  onStringArray: (count: number) => void,
): void {
  walk(ast, (node) => {
    if (node.type === 'Identifier') {
      idents.push(String(node.name).length);
    } else if (node.type === 'ArrayExpression') {
      const elements = (node.elements as unknown[]) ?? [];
      const stringCount = elements.filter(
        (e): e is { type: string; value: unknown } =>
          !!e && typeof e === 'object' && (e as { type: string }).type === 'Literal' && typeof (e as { value: unknown }).value === 'string',
      ).length;
      if (stringCount > 0) onStringArray(stringCount);
    }
  });
}

type AnyNode = {
  type: string;
  name?: unknown;
  elements?: unknown;
  [key: string]: unknown;
};

function walk(node: unknown, visit: (node: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if ('type' in (node as object)) visit(node as AnyNode);
  for (const key of Object.keys(node as object)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') continue;
    const value = (node as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object' && 'type' in value) {
      walk(value, visit);
    }
  }
}
