/**
 * Keymap helpers: hotkeys as strings, matching key presses, parsing "Mod+Shift+P", and the shortcuts the
 * operating system or the app shell already use (a command bound to one of those would never run, or would
 * stop working on another system). Pure: no DOM, so it is unit-tested.
 */
import type { Hotkey, Modifier } from './plugin';

/** Where a shortcut applies. A command without `context` is global. */
export type KeyContext = 'global' | 'editor' | 'docket';

export interface Platformish { isMacOS: boolean; isWin?: boolean; isLinux?: boolean }

/** "Ctrl+Shift+P" (Mod resolved for the platform; modifiers sorted). */
export function hotkeyString(h: Hotkey, p: Platformish): string {
	const mods = [...new Set(h.modifiers.map((m) => (m === 'Mod' ? (p.isMacOS ? 'Meta' : 'Ctrl') : m)))].sort();
	return [...mods, h.key.length === 1 ? h.key.toUpperCase() : h.key].join('+');
}

/** Physical keys whose character changes with Shift ("\\" becomes "|"): matched by the unshifted one. */
const CODE_KEYS: Record<string, string> = {
	Backslash: '\\', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
	Comma: ',', Period: '.', Slash: '/', Backquote: '`',
	Digit0: '0', Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5', Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9',
};

/**
 * The key pressed, as hotkeys name it: with Shift (or Alt on macOS) held, punctuation and digits type
 * another character, and Option+letter on macOS types a symbol (⌥K is ˚) or starts an accent, so those
 * are read from the physical key.
 */
export function physicalKey(e: { altKey: boolean; shiftKey: boolean; key: string; code?: string }): string {
	if ((e.shiftKey || e.altKey) && e.code && CODE_KEYS[e.code] && !/^[a-z0-9]$/i.test(e.key)) return CODE_KEYS[e.code]!;
	if (e.altKey && e.code && /^Key[A-Z]$/.test(e.code) && !/^[a-z]$/i.test(e.key)) return e.code.slice(3).toLowerCase();
	return e.key;
}

/** The same form for a key press. */
export function eventString(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string; code?: string }): string {
	const mods: string[] = [];
	if (e.altKey) mods.push('Alt');
	if (e.ctrlKey) mods.push('Ctrl');
	if (e.metaKey) mods.push('Meta');
	if (e.shiftKey) mods.push('Shift');
	// With Shift (or Alt on macOS) held, punctuation and digits type another character: use the key itself.
	const raw = physicalKey(e);
	const key = raw.length === 1 ? raw.toUpperCase() : raw;
	return [...mods.sort(), key].join('+');
}

/** For display: ⌘ ⌥ ⇧ ⌃ on macOS, words elsewhere. */
export function formatHotkey(h: Hotkey, p: Platformish): string {
	const s = hotkeyString(h, p);
	if (!p.isMacOS) return s;
	return s.replace('Meta', '⌘').replace('Alt', '⌥').replace('Shift', '⇧').replace('Ctrl', '⌃').replace(/\+/g, '');
}

/** "Mod+Shift+P" → { modifiers: ['Mod', 'Shift'], key: 'p' }. */
export function parseHotkey(s: string): Hotkey {
	const parts = s.split('+').map((x) => x.trim()).filter(Boolean);
	const key = parts.pop() ?? '';
	const valid: Modifier[] = ['Mod', 'Ctrl', 'Meta', 'Shift', 'Alt'];
	const modifiers = parts.filter((m): m is Modifier => (valid as string[]).includes(m));
	return { modifiers, key: key.length === 1 ? key.toLowerCase() : key };
}

/**
 * Shortcuts taken by the operating system, the window or text editing. Binding a command to one either
 * never fires or takes away something people rely on. Each entry: the hotkey and what it does.
 */
const RESERVED: { keys: string; what: string; on?: 'mac' | 'other' }[] = [
	{ keys: 'Mod+Q', what: 'Quit', on: 'mac' },
	{ keys: 'Mod+H', what: 'Hide the app', on: 'mac' },
	{ keys: 'Mod+M', what: 'Minimise the window', on: 'mac' },
	{ keys: 'Mod+Tab', what: 'Switch apps', on: 'mac' },
	{ keys: 'Mod+Space', what: 'Spotlight', on: 'mac' },
	{ keys: 'Mod+Alt+Escape', what: 'Force quit', on: 'mac' },
	{ keys: 'Alt+F4', what: 'Close the window', on: 'other' },
	{ keys: 'Alt+Tab', what: 'Switch apps', on: 'other' },
	{ keys: 'Meta+L', what: 'Lock the screen', on: 'other' },
	{ keys: 'Mod+Alt+Delete', what: 'System menu', on: 'other' },
	{ keys: 'Mod+C', what: 'Copy' },
	{ keys: 'Mod+X', what: 'Cut' },
	{ keys: 'Mod+V', what: 'Paste' },
	{ keys: 'Mod+Z', what: 'Undo' },
	{ keys: 'Mod+Shift+Z', what: 'Redo' },
	{ keys: 'Mod+A', what: 'Select all' },
	{ keys: 'Mod+F', what: 'Find in the note' },
	{ keys: 'F12', what: 'Developer tools' },
	{ keys: 'Mod+Shift+I', what: 'Developer tools' },
];

/** What the system or shell already does with this hotkey, if anything. */
export function reservedFor(h: Hotkey, p: Platformish): string | null {
	const key = hotkeyString(h, p);
	for (const r of RESERVED) {
		if (r.on === 'mac' && !p.isMacOS) continue;
		if (r.on === 'other' && p.isMacOS) continue;
		if (hotkeyString(parseHotkey(r.keys), p) === key) return r.what;
	}
	return null;
}
