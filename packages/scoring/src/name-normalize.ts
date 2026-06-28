/**
 * Name normalization for typosquat detection (design 13.2).
 *
 * Normalizes package names to detect confusable variants.
 */

/**
 * Normalize a package name for comparison.
 *
 * Rules (design 13.2):
 * 1. Lowercase the name.
 * 2. Strip punctuation variants.
 * 3. Normalize Unicode confusables.
 * 4. Normalize common character substitutions:
 *    - 0 ↔ o
 *    - 1 ↔ l / i
 *    - _ ↔ - / .
 */
export function normalizeName(name: string): string {
  let result = name.toLowerCase();

  // Normalize Unicode confusables first (before stripping non-ASCII).
  result = normalizeConfusables(result);

  // Normalize common substitutions (before stripping punctuation).
  result = result
    .replace(/0/g, 'o')   // 0 → o
    .replace(/1/g, 'l')   // 1 → l
    .replace(/_/g, '-')   // _ → -
    .replace(/\./g, '-'); // . → -

  // Strip remaining punctuation: keep only alphanumeric and - and @ and /
  result = result.replace(/[^a-z0-9@/-]/g, '');

  return result;
}

/**
 * Normalize Unicode confusable characters.
 * This is a basic set — a full implementation would use the Unicode
 * Confusables database.
 */
function normalizeConfusables(s: string): string {
  const confusables: Record<string, string> = {
    'а': 'a', // Cyrillic а → Latin a
    'е': 'e', // Cyrillic е → Latin e
    'о': 'o', // Cyrillic о → Latin o
    'р': 'p', // Cyrillic р → Latin p
    'с': 'c', // Cyrillic с → Latin c
    'у': 'y', // Cyrillic у → Latin y
    'х': 'x', // Cyrillic х → Latin x
    'і': 'i', // Cyrillic і → Latin i
    'ј': 'j', // Cyrillic ј → Latin j
    'ѕ': 's', // Cyrillic ѕ → Latin s
  };
  return s.replace(/[аеорсуxіјѕ]/g, (c) => confusables[c] ?? c);
}

/**
 * Get the scope and unscoped name from a package name.
 */
export function splitScope(name: string): { scope: string | undefined; name: string } {
  if (name.startsWith('@')) {
    const slashIdx = name.indexOf('/');
    if (slashIdx > 0) {
      return {
        scope: name.slice(0, slashIdx),
        name: name.slice(slashIdx + 1),
      };
    }
  }
  return { scope: undefined, name };
}
