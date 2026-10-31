/**
 * Best-effort implementation of Excel number formats for display. Covers the
 * built-in formats and the common custom patterns (thousands separators,
 * decimals, percentages, scientific, currency literals, dates and times,
 * multi-section positive;negative;zero;text). Not covered: fractions,
 * conditional sections beyond sign, locale-specific calendars.
 */

export const BUILTIN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  12: '# ?/?',
  13: '# ??/??',
  14: 'm/d/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'm/d/yyyy h:mm',
  37: '#,##0 ;(#,##0)',
  38: '#,##0 ;[Red](#,##0)',
  39: '#,##0.00;(#,##0.00)',
  40: '#,##0.00;[Red](#,##0.00)',
  44: '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  48: '##0.0E+0',
  49: '@',
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Splits a format into sections on `;` outside quotes / brackets / escapes. */
export function splitSections(format: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < format.length; i += 1) {
    const ch = format[i]!;
    if (ch === '\\' && !quoted) {
      cur += ch + (format[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '[') bracket = true;
    else if (!quoted && ch === ']') bracket = false;
    if (ch === ';' && !quoted && !bracket) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Removes quoted literals, escapes and brackets so tokens can be inspected. */
function stripLiterals(section: string): string {
  return section
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[_*]./g, '');
}

export function isDateFormat(format: string): boolean {
  const s = stripLiterals(splitSections(format)[0] ?? '');
  if (/^General$/i.test(s.trim())) return false;
  if (/\[h+\]|\[m+\]|\[s+\]/i.test(splitSections(format)[0] ?? '')) return true;
  return /[ymdhs]/i.test(s.replace(/E[+-]/gi, ''));
}

export function excelSerialToDate(serial: number, date1904 = false): Date {
  // Excel's 1900 system includes the fictitious 1900-02-29 (serial 60).
  const days = date1904 ? serial + 1462 : serial < 60 ? serial + 1 : serial;
  const ms = Math.round((days - 25569) * 86400 * 1000);
  return new Date(ms);
}

/** Literal text of a section part: resolves quotes, escapes, `_x` padding, removes `*x` fill and brackets. */
function literal(part: string): string {
  let out = '';
  for (let i = 0; i < part.length; i += 1) {
    const ch = part[i]!;
    if (ch === '"') {
      const end = part.indexOf('"', i + 1);
      out += part.slice(i + 1, end === -1 ? undefined : end);
      i = end === -1 ? part.length : end;
    } else if (ch === '\\') {
      out += part[i + 1] ?? '';
      i += 1;
    } else if (ch === '_') {
      out += ' ';
      i += 1;
    } else if (ch === '*') {
      i += 1;
    } else if (ch === '[') {
      const end = part.indexOf(']', i);
      const inner = part.slice(i + 1, end === -1 ? undefined : end);
      const currency = /^\$([^-\]]*)/.exec(inner);
      if (currency) out += currency[1];
      i = end === -1 ? part.length : end;
    } else out += ch;
  }
  return out;
}

function pad(n: number, len: number): string {
  return String(n).padStart(len, '0');
}

export function formatDate(serial: number, section: string, date1904 = false): string {
  const date = excelSerialToDate(serial, date1904);
  const y = date.getUTCFullYear();
  const mo = date.getUTCMonth();
  const d = date.getUTCDate();
  const wd = date.getUTCDay();
  const h = date.getUTCHours();
  const mi = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();
  const ampm = /AM\/PM|A\/P/i.test(section);
  const elapsedH = Math.floor(serial * 24);

  const tokens =
    section.match(
      /"[^"]*"|\\.|\[[^\]]*\]|AM\/PM|A\/P|y+|m+|d+|h+|s+(?:\.0+)?|[^ymdhsa"\\[]+|./gi,
    ) ?? [];
  let out = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    const lower = t.toLowerCase();
    if (t.startsWith('"') || t.startsWith('\\')) {
      out += literal(t);
    } else if (t.startsWith('[')) {
      if (/^\[h+\]$/i.test(t)) out += String(elapsedH);
      else if (/^\[m+\]$/i.test(t)) out += String(Math.floor(serial * 1440));
      else if (/^\[s+\]$/i.test(t)) out += String(Math.round(serial * 86400));
      else out += literal(t);
    } else if (/^y+$/.test(lower)) {
      out += lower.length <= 2 ? pad(y % 100, 2) : String(y);
    } else if (/^m+$/.test(lower)) {
      // "m" after h or before s means minutes.
      const prev = tokens
        .slice(0, i)
        .reverse()
        .find((x) => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x));
      const next = tokens
        .slice(i + 1)
        .find((x) => /^[a-z]/i.test(x) && !/^(am\/pm|a\/p)$/i.test(x));
      const minutes = (prev && /^h/i.test(prev)) || (next && /^s/i.test(next));
      if (minutes && lower.length <= 2) out += lower.length === 2 ? pad(mi, 2) : String(mi);
      else if (lower.length === 1) out += String(mo + 1);
      else if (lower.length === 2) out += pad(mo + 1, 2);
      else if (lower.length === 3) out += MONTHS[mo]!.slice(0, 3);
      else if (lower.length === 5) out += MONTHS[mo]![0];
      else out += MONTHS[mo];
    } else if (/^d+$/.test(lower)) {
      if (lower.length === 1) out += String(d);
      else if (lower.length === 2) out += pad(d, 2);
      else if (lower.length === 3) out += DAYS[wd]!.slice(0, 3);
      else out += DAYS[wd];
    } else if (/^h+$/.test(lower)) {
      let hh = h;
      if (ampm) hh = h % 12 === 0 ? 12 : h % 12;
      out += lower.length >= 2 ? pad(hh, 2) : String(hh);
    } else if (/^s+/.test(lower)) {
      const [sec, frac] = lower.split('.');
      out += sec!.length >= 2 ? pad(s, 2) : String(s);
      if (frac) out += `.${pad(Math.round(ms / Math.pow(10, 3 - frac.length)), frac.length)}`;
    } else if (/^am\/pm$/i.test(t)) {
      out += h < 12 ? 'AM' : 'PM';
    } else if (/^a\/p$/i.test(t)) {
      out += h < 12 ? 'A' : 'P';
    } else {
      out += literal(t);
    }
  }
  return out;
}

function formatGeneral(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e11) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    const [m, e] = value.toExponential(5).split('e');
    const exp = Number(e);
    return `${m!.replace(/\.?0+$/, '')}E${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return String(Number(value.toPrecision(11)));
}

function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Formats `value` using the numeric pattern part (e.g. `#,##0.00`, `0.0%`, `0.00E+00`). */
function formatNumberPattern(value: number, pattern: string): string {
  const clean = stripLiterals(pattern);
  const percentCount = (clean.match(/%/g) ?? []).length;
  let v = value * Math.pow(100, percentCount);
  const sci = /E[+-]/i.exec(clean);
  if (sci) {
    const [mant, exp] = clean.split(/E[+-]/i);
    const decimals = (mant!.split('.')[1] ?? '').replace(/[^0#?]/g, '').length;
    const expDigits = (exp ?? '').replace(/[^0#?]/g, '').length || 1;
    if (v === 0) return `${(0).toFixed(decimals)}E+${'0'.repeat(expDigits)}`;
    const e = Math.floor(Math.log10(Math.abs(v)));
    const m = v / Math.pow(10, e);
    const sign = e < 0 ? '-' : '+';
    return `${m.toFixed(decimals)}E${sign}${String(Math.abs(e)).padStart(expDigits, '0')}`;
  }
  // Commas right after the last digit placeholder scale by thousands.
  const lastDigit = Math.max(
    clean.lastIndexOf('0'),
    clean.lastIndexOf('#'),
    clean.lastIndexOf('?'),
  );
  const scale = /^,+/.exec(clean.slice(lastDigit + 1));
  if (scale) v /= Math.pow(1000, scale[0].length);
  const [intPat, decPat = ''] = clean.replace(/%/g, '').split('.');
  const minDecimals = (decPat.match(/0/g) ?? []).length;
  const maxDecimals = (decPat.match(/[0#?]/g) ?? []).length;
  const minInt = (intPat!.match(/0/g) ?? []).length;
  const thousands = /[0#?],[0#?]/.test(intPat!);
  let str = Math.abs(v).toFixed(maxDecimals);
  let [i, d = ''] = str.split('.');
  if (maxDecimals > minDecimals)
    d = d.replace(new RegExp(`0{1,${maxDecimals - minDecimals}}$`), '');
  if (i === '0' && minInt === 0) i = '';
  i = i!.padStart(minInt, '0');
  if (thousands) i = groupThousands(i);
  str = d ? `${i}.${d}` : maxDecimals > 0 && minDecimals === 0 && /\./.test(clean) ? `${i}.` : i;
  if (str.endsWith('.') && !decPat) str = str.slice(0, -1);
  return str + '%'.repeat(percentCount);
}

function applySection(
  value: number,
  section: string,
  date1904: boolean,
  isNegativeSection: boolean,
): string {
  if (isDateFormat(section)) return formatDate(value, section, date1904);
  const s = section
    .replace(/\[(Red|Black|Blue|Green|White|Yellow|Magenta|Cyan|Color\s*\d+)\]/gi, '')
    .replace(/\[[<>=][^\]]*\]/g, '');
  if (/^\s*General\s*$/i.test(s)) return formatGeneral(value);
  if (!/[0#?]/.test(stripLiterals(s))) return literal(s);
  // Locate the numeric pattern span.
  let first = -1;
  let last = -1;
  let quoted = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]!;
    if (ch === '"') quoted = !quoted;
    if (quoted) continue;
    if (ch === '\\' || ch === '_' || ch === '*') {
      i += 1;
      continue;
    }
    if (ch === '[') {
      i = Math.max(i, s.indexOf(']', i));
      continue;
    }
    if (/[0#?]/.test(ch)) {
      if (first === -1) first = i;
      last = i;
    }
  }
  let end = last + 1;
  // Include %, decimal and scientific suffixes immediately after the last digit placeholder.
  const tail = /^(?:[.,%]|E[+-][0#?]+)*/i.exec(s.slice(end))?.[0] ?? '';
  end += tail.length;
  let start = first;
  while (start > 0 && /[,.]/.test(s[start - 1]!)) start -= 1;
  const prefix = literal(s.slice(0, start));
  const suffix = literal(s.slice(end));
  const num = formatNumberPattern(Math.abs(value), s.slice(start, end));
  const sign = value < 0 && !isNegativeSection && /[1-9]/.test(num) ? '-' : '';
  return `${sign}${prefix}${num}${suffix}`;
}

/** Formats a cell value with an Excel number format code. */
export function formatCellValue(
  value: number | string | boolean | null,
  format: string,
  date1904 = false,
): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  const sections = splitSections(format || 'General');
  if (typeof value === 'string') {
    const textSection = sections.length >= 4 ? sections[3]! : sections.find((x) => x.includes('@'));
    return textSection ? literal(textSection).replace('@', value) : value;
  }
  if (!Number.isFinite(value)) return String(value);
  try {
    if (sections.length === 1 || (value > 0 && sections.length >= 1)) {
      if (sections.length > 1 && value === 0 && sections[2] !== undefined)
        return applySection(value, sections[2], date1904, false);
      return applySection(value, sections[0]!, date1904, false);
    }
    if (value < 0)
      return applySection(value, sections[1] ?? sections[0]!, date1904, sections[1] !== undefined);
    return applySection(value, sections[2] ?? sections[0]!, date1904, false);
  } catch {
    /* istanbul ignore next -- defensive: never fail rendering because of a format */
    return formatGeneral(value);
  }
}
