import type { ShortcutAction } from '../types';

interface ParsedShortcut {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean | undefined;
}

const cache = new Map<string, ParsedShortcut>();

/** Parses `mod+shift+f` style combos. `mod` is ⌘ on Apple platforms and Ctrl elsewhere. */
export function parseShortcut(combo: string): ParsedShortcut {
  const hit = cache.get(combo);
  if (hit) return hit;
  // Support "mod++" (plus key) by splitting on "+" not followed by end.
  const parts = combo === '+' ? ['+'] : combo.split(/\+(?!$)/);
  const parsed: ParsedShortcut = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: undefined,
  };
  for (const raw of parts) {
    const p = raw.trim();
    const lower = p.toLowerCase();
    if (lower === 'mod') parsed.mod = true;
    else if (lower === 'ctrl' || lower === 'control') parsed.ctrl = true;
    else if (lower === 'meta' || lower === 'cmd') parsed.meta = true;
    else if (lower === 'alt' || lower === 'option') parsed.alt = true;
    else if (lower === 'shift') parsed.shift = true;
    else parsed.key = p;
  }
  cache.set(combo, parsed);
  return parsed;
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const p =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ||
    navigator.platform ||
    '';
  return /mac|iphone|ipad|ipod/i.test(p);
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>;

export function matchesShortcut(event: KeyLike, combo: string, apple = isApplePlatform()): boolean {
  const s = parseShortcut(combo);
  if (!s.key) return false;
  const wantCtrl = s.ctrl || (s.mod && !apple);
  const wantMeta = s.meta || (s.mod && apple);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== s.alt)
    return false;
  // Shift is only enforced when declared, because many keys ("+", "?") require it.
  if (s.shift === true && !event.shiftKey) return false;
  if (
    s.shift === undefined &&
    event.shiftKey &&
    s.key.length > 1 &&
    /^F\d+$|^Arrow|^Page/.test(s.key)
  ) {
    return false;
  }
  return event.key.toLowerCase() === s.key.toLowerCase();
}

export function findShortcutAction(
  event: KeyLike,
  shortcuts: Record<ShortcutAction, string[]>,
  apple = isApplePlatform(),
): ShortcutAction | undefined {
  for (const [action, combos] of Object.entries(shortcuts) as Array<[ShortcutAction, string[]]>) {
    if (combos.some((c) => matchesShortcut(event, c, apple))) return action;
  }
  return undefined;
}

/** True when keyboard focus is in a text field, where single-key shortcuts must not fire. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}

/** Shortcuts that consist of a single printable key and no modifiers. */
export function isSingleKeyCombo(combo: string): boolean {
  const s = parseShortcut(combo);
  return !s.mod && !s.ctrl && !s.meta && !s.alt && s.key.length === 1;
}
