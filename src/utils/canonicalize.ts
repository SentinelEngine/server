/**
 * Canonical JSON serializer — produces deterministic JSON output
 * regardless of the insertion order of object keys.
 * Critical for tamper-proof hashing: the same logical data must always
 * produce the same byte string.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  // Sort keys for deterministic ordering
  const keys  = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(k => `${JSON.stringify(k)}:${canonicalize((value as any)[k])}`);
  return '{' + parts.join(',') + '}';
}
