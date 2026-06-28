/**
 * Similarity scoring for typosquat detection (design 13.3).
 *
 * Compares package names using edit distance and Jaro-Winkler similarity
 * to detect potential typosquats.
 */

import { normalizeName, splitScope } from './name-normalize.js';
import type { PopularPackageCorpus } from './name-corpus.js';

export interface NameRiskResult {
  /** The input package name. */
  name: string;
  /** Whether this name is a likely typosquat. */
  isTyposquat: boolean;
  /** Confidence level: high, medium, low. */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** The similar popular package, if any. */
  similarTo?: string;
  /** Edit distance to the closest popular package. */
  editDistance?: number;
  /** Jaro-Winkler similarity (0-1). */
  jaroWinkler?: number;
  /** Risk score deduction (0-100). */
  deduction: number;
}

/**
 * Compute Levenshtein edit distance between two strings.
 */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }
  return dp[m][n];
}

/**
 * Compute Jaro-Winkler similarity between two strings (0-1).
 */
export function jaroWinkler(s1: string, s2: string): number {
  const jaro = jaroSimilarity(s1, s2);
  // Winkler prefix bonus: up to 4 matching prefix characters.
  const prefixLen = Math.min(4, commonPrefixLength(s1, s2));
  return jaro + prefixLen * 0.1 * (1 - jaro);
}

function jaroSimilarity(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;

  const matchDistance = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (s2Matches[j]) continue;
      if (s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions.
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  transpositions /= 2;

  return (matches / s1.length + matches / s2.length + (matches - transpositions) / matches) / 3;
}

function commonPrefixLength(s1: string, s2: string): number {
  let i = 0;
  while (i < s1.length && i < s2.length && s1[i] === s2[i]) i++;
  return i;
}

/**
 * Compute name risk for a package name against a popular package corpus.
 */
export function computeNameRisk(
  name: string,
  corpus: PopularPackageCorpus,
): NameRiskResult {
  // If the package IS in the corpus, it's not a typosquat.
  if (corpus.isPopular(name)) {
    return { name, isTyposquat: false, confidence: 'none', deduction: 0 };
  }

  const { scope, name: unscoped } = splitScope(name);
  const normalizedInput = normalizeName(unscoped);

  let bestMatch: { name: string; editDist: number; jw: number } | null = null;

  for (const pkg of corpus.list()) {
    const { name: popularUnscoped } = splitScope(pkg.name);
    const normalizedPopular = normalizeName(popularUnscoped);

    // Compare scoped and unscoped names separately (design 13.3).
    if (scope && !pkg.name.startsWith(scope)) continue;

    const editDist = editDistance(normalizedInput, normalizedPopular);
    const jw = jaroWinkler(normalizedInput, normalizedPopular);

    if (!bestMatch || jw > bestMatch.jw) {
      bestMatch = { name: pkg.name, editDist, jw };
    }
  }

  if (!bestMatch) {
    return { name, isTyposquat: false, confidence: 'none', deduction: 0 };
  }

  // Determine confidence and deduction.
  // High confidence: JW >= 0.95 and edit distance <= 2
  // Medium confidence: JW >= 0.85 and edit distance <= 3
  // Low confidence: JW >= 0.75
  let confidence: NameRiskResult['confidence'] = 'none';
  let deduction = 0;
  let isTyposquat = false;

  if (bestMatch.jw >= 0.95 && bestMatch.editDist <= 2) {
    confidence = 'high';
    deduction = 40;
    isTyposquat = true;
  } else if (bestMatch.jw >= 0.85 && bestMatch.editDist <= 3) {
    confidence = 'medium';
    deduction = 20;
    isTyposquat = true;
  } else if (bestMatch.jw >= 0.75) {
    confidence = 'low';
    deduction = 10;
  }

  return {
    name,
    isTyposquat,
    confidence,
    similarTo: bestMatch.name,
    editDistance: bestMatch.editDist,
    jaroWinkler: bestMatch.jw,
    deduction,
  };
}
