// FNV-1a 64-bit over a canonical JSON string. A fingerprint for change detection, not a security hash.
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value as object).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical((value as any)[k])).join(',') + '}';
}

export function fingerprint(value: unknown): string {
  const s = typeof value === 'string' ? value : canonical(value);
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}
