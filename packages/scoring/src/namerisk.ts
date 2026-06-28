import type { RiskFinding } from '@safe-npm/core-types';

/** Popular package corpus entry. */
export interface PopularPackage {
  name: string;
  /** Popularity rank (1 = most popular). Lower is more popular. */
  rank: number;
}

/**
 * Built-in popular package corpus fixture. In production this would be
 * updated from download counts; here it is a static placeholder with a
 * scheduled-update hook.
 */
export const DEFAULT_POPULAR_CORPUS: PopularPackage[] = [
  { name: 'lodash', rank: 1 },
  { name: 'request', rank: 2 },
  { name: 'express', rank: 3 },
  { name: 'chalk', rank: 4 },
  { name: 'react', rank: 5 },
  { name: 'is-odd', rank: 100 },
  { name: 'is-even', rank: 101 },
  { name: 'left-pad', rank: 102 },
  { name: 'colors', rank: 103 },
  { name: 'minimist', rank: 104 },
];

/** Placeholder for a scheduled corpus update; real impl would fetch counts. */
export async function updatePopularCorpus(): Promise<void> {
  // no-op placeholder; production would refresh from npm download counts
}

/** Unicode confusable + common-substitution normalization map. */
const CONFUSABLE: Record<string, string> = {
  '0': 'o',
  '1': 'l',
  '|': 'l',
  '3': 'e',
  '4': 'a',
  '@': 'a',
  '$': 's',
  '5': 's',
  '7': 't',
  '2': 'z',
};

/** Normalize a package name for typosquat comparison. */
export function normalizeName(name: string): string {
  // strip scope for comparison
  const unscoped = name.startsWith('@') ? name.split('/')[1] ?? name : name;
  let out = unscoped.toLowerCase();
  // strip punctuation variants: _ . - -> collapse
  out = out.replace(/[._-]/g, '');
  // apply confusable substitutions
  let substituted = '';
  for (const ch of out) {
    substituted += CONFUSABLE[ch] ?? ch;
  }
  return substituted;
}

/** Levenshtein edit distance between two strings. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((prev[j] ?? 0) + 1, (curr[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j] ?? 0;
  }
  return prev[n]!;
}

/** Jaro-Winkler similarity (0..1, higher = more similar). */
export function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  // common prefix up to 4
  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(a.length, b.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

function jaro(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const matchDistance = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const aMatches = new Array<boolean>(la).fill(false);
  const bMatches = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const start = Math.max(0, i - matchDistance);
    const end = Math.min(i + matchDistance + 1, lb);
    for (let j = start; j < end; j++) {
      if (bMatches[j]) continue;
      if (a[i] !== b[j]) continue;
      aMatches[i] = true;
      bMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!aMatches[i]) continue;
    while (!bMatches[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (matches / la + matches / lb + (matches - transpositions) / matches) / 3;
}

export interface NameRiskResult {
  score: number; // 0..100, higher = safer
  similarTo: string[];
  reasons: string[];
  /** Confidence 0..1 that this is a typosquat. */
  typosquatConfidence: number;
  action: 'allow' | 'warn' | 'block';
  findings: RiskFinding[];
}

export interface NameRiskInput {
  packageName: string;
  /** Popular corpus to compare against. */
  corpus?: PopularPackage[];
  /** Whether this is a new package with no install history. */
  isNewPackage?: boolean;
  /** Whether author/maintainer mismatches the claimed brand. */
  authorMismatch?: boolean;
  /** Whether provenance is present. */
  hasProvenance?: boolean;
}

/**
 * Compute name-risk / typosquat score for a package name.
 * Returns a score (higher = safer), similarity reasons, and an action.
 */
export function computeNameRisk(input: NameRiskInput): NameRiskResult {
  const corpus = input.corpus ?? DEFAULT_POPULAR_CORPUS;
  const normalized = normalizeName(input.packageName);
  const similarTo: string[] = [];
  const reasons: string[] = [];
  let maxConfidence = 0;

  for (const popular of corpus) {
    const popNorm = normalizeName(popular.name);
    // skip self
    if (popNorm === normalized && popular.name === input.packageName) continue;
    const dist = levenshtein(normalized, popNorm);
    const jw = jaroWinkler(normalized, popNorm);
    // similarity confidence: close edit distance + high jaro-winkler
    const lengthMax = Math.max(normalized.length, popNorm.length, 1);
    const editSimilarity = 1 - dist / lengthMax;
    const confidence = Math.max(editSimilarity, jw);
    // only flag if reasonably similar and the popular package is well-known
    if (confidence >= 0.85 && popular.rank <= 200) {
      similarTo.push(popular.name);
      if (dist === 1 && popular.rank <= 50) {
        reasons.push(`1 edit from popular package ${popular.name}`);
        maxConfidence = Math.max(maxConfidence, 0.95);
      } else if (dist <= 2) {
        reasons.push(`${dist} edits from ${popular.name}`);
        maxConfidence = Math.max(maxConfidence, confidence);
      } else if (jw >= 0.9) {
        reasons.push(`high Jaro-Winkler similarity to ${popular.name}`);
        maxConfidence = Math.max(maxConfidence, jw);
      }
    }
  }

  if (input.isNewPackage && similarTo.length > 0) {
    reasons.push('new package with no history similar to popular package');
    maxConfidence = Math.max(maxConfidence, 0.8);
  }
  if (input.authorMismatch) {
    reasons.push('author mismatch with claimed brand');
    maxConfidence = Math.max(maxConfidence, 0.7);
  }
  if (input.hasProvenance) {
    // provenance reduces typosquat confidence
    maxConfidence = Math.max(0, maxConfidence - 0.2);
  }

  const typosquatConfidence = Math.min(1, maxConfidence);
  // score: higher = safer. 100 - confidence*100
  const score = Math.round(100 - typosquatConfidence * 100);
  let action: NameRiskResult['action'] = 'allow';
  if (typosquatConfidence >= 0.9) action = 'block';
  else if (typosquatConfidence >= 0.6) action = 'warn';

  const findings: RiskFinding[] = [];
  if (action === 'block') {
    findings.push({
      code: 'TYPOSQUAT_HIGH_CONFIDENCE',
      severity: 'critical',
      message: `high-confidence typosquat similar to ${similarTo.join(', ')}`,
      evidence: reasons,
    });
  } else if (action === 'warn') {
    findings.push({
      code: 'TYPOSQUAT_SUSPECTED',
      severity: 'medium',
      message: `possible typosquat similar to ${similarTo.join(', ')}`,
      evidence: reasons,
    });
  }

  return { score, similarTo, reasons, typosquatConfidence, action, findings };
}

/**
 * Publish-time name gate: block high-confidence typosquats, require review
 * for medium-confidence. Returns a decision.
 */
export function nameGate(
  input: NameRiskInput,
): { decision: 'allow' | 'block' | 'require_review'; result: NameRiskResult } {
  const result = computeNameRisk(input);
  let decision: 'allow' | 'block' | 'require_review' = 'allow';
  if (result.typosquatConfidence >= 0.9) decision = 'block';
  else if (result.typosquatConfidence >= 0.6) decision = 'require_review';
  return { decision, result };
}
