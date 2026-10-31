import type { Token } from './TextLines';

const JSON_TOKEN =
  /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],])/g;

/** Line-level JSON tokenizer for the raw view (keys, strings, numbers, literals). */
export function tokenizeJsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  JSON_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_TOKEN.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], type: m[2] !== undefined ? 'key' : 'string' });
      if (m[2]) tokens.push({ text: m[2], type: 'punct' });
    } else if (m[3] !== undefined) tokens.push({ text: m[3], type: 'number' });
    else if (m[4] !== undefined) tokens.push({ text: m[4], type: 'boolean' });
    else if (m[5] !== undefined) tokens.push({ text: m[5], type: 'null' });
    else tokens.push({ text: m[0], type: 'punct' });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  return tokens;
}

const XML_TOKEN =
  /(<!--[\s\S]*?(?:-->|$))|(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))|(<\?[\s\S]*?(?:\?>|$))|(<\/?)([\w:.-]+)|(\/?>)|([\w:.-]+)(=)("[^"]*"|'[^']*')/g;

/** Line-level XML tokenizer for the raw view. */
export function tokenizeXmlLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  XML_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = XML_TOKEN.exec(line)) !== null) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    if (m[1]) tokens.push({ text: m[1], type: 'comment' });
    else if (m[2]) tokens.push({ text: m[2], type: 'cdata' });
    else if (m[3]) tokens.push({ text: m[3], type: 'meta' });
    else if (m[4]) {
      tokens.push({ text: m[4], type: 'punct' });
      tokens.push({ text: m[5]!, type: 'tag' });
    } else if (m[6]) tokens.push({ text: m[6], type: 'punct' });
    else {
      tokens.push({ text: m[7]!, type: 'attr' });
      tokens.push({ text: m[8]!, type: 'punct' });
      tokens.push({ text: m[9]!, type: 'string' });
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });
  return tokens;
}
