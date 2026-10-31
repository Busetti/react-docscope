export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[i]}`;
}

export function formatDate(value: unknown, locale?: string): string {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    /* istanbul ignore next */
    return d.toISOString();
  }
}

/** Human friendly label for a key such as `uploadedAt` → "Uploaded at". */
export function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
