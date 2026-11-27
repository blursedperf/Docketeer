/**
 * Icon sets bundled with the app. Phosphor (MIT, phosphoricons.com) is the default; its SVGs are read
 * at build time (see build.mjs) into one path per icon and weight.
 */
import { registerIconPack } from '@quire/api';
import phosphor from 'virtual:phosphor-icons';

/** Lucide names (what plugins ask for) to Phosphor names, where they differ. */
export const LUCIDE_TO_PHOSPHOR: Record<string, string> = {
	'alert-circle': 'warning-circle', 'alert-triangle': 'warning', 'arrow-down': 'arrow-down', 'arrow-left': 'arrow-left',
	'arrow-right': 'arrow-right', 'arrow-up': 'arrow-up', 'arrow-up-right': 'arrow-up-right', 'at-sign': 'at',
	'bar-chart': 'chart-bar', 'bar-chart-2': 'chart-bar', bell: 'bell', bold: 'text-b', book: 'book', 'book-open': 'book-open',
	'book-open-text': 'book-open-text', bookmark: 'bookmark-simple', bot: 'robot', 'box': 'package', 'calendar': 'calendar-blank',
	'calendar-days': 'calendar', check: 'check', 'check-circle': 'check-circle', 'check-circle-2': 'check-circle',
	'check-square': 'check-square', 'chevron-down': 'caret-down', 'chevron-left': 'caret-left', 'chevron-right': 'caret-right',
	'chevron-up': 'caret-up', 'chevrons-down-up': 'arrows-in-line-vertical', 'chevrons-up-down': 'arrows-out-line-vertical',
	'chevrons-left': 'caret-double-left', 'chevrons-right': 'caret-double-right', circle: 'circle', 'circle-help': 'question',
	'help-circle': 'question', 'circle-dot': 'radio-button', clipboard: 'clipboard', 'clipboard-copy': 'clipboard-text',
	'clipboard-list': 'clipboard-text', clock: 'clock', code: 'code', 'code-2': 'code-simple', cog: 'gear', columns: 'columns',
	command: 'command', copy: 'copy', 'corner-down-left': 'arrow-elbow-down-left', crown: 'crown', download: 'download-simple',
	edit: 'note-pencil', 'edit-2': 'pencil-simple', 'edit-3': 'pencil-simple-line', 'external-link': 'arrow-square-out',
	eye: 'eye', 'eye-off': 'eye-slash', file: 'file', 'file-check': 'file-text', 'file-code': 'file-code',
	'file-input': 'file-arrow-down', 'file-output': 'file-arrow-up', 'file-plus': 'file-plus', 'file-minus': 'file-minus',
	'file-question': 'file-dashed', 'file-search': 'file-magnifying-glass', 'file-text': 'file-text', 'file-x': 'file-x',
	files: 'files', filter: 'funnel', flag: 'flag', folder: 'folder', 'folder-closed': 'folder', 'folder-open': 'folder-open',
	'folder-plus': 'folder-plus', 'folder-tree': 'tree-structure', 'git-branch': 'git-branch', globe: 'globe', 'grip-vertical': 'dots-six-vertical',
	hash: 'hash', heading: 'text-h', 'heading-1': 'text-h-one', 'heading-2': 'text-h-two', 'heading-3': 'text-h-three',
	heart: 'heart', highlighter: 'highlighter', history: 'clock-counter-clockwise', home: 'house', 'house': 'house', image: 'image',
	inbox: 'tray', info: 'info', italic: 'text-italic', key: 'key', 'layout-dashboard': 'squares-four', 'layout-grid': 'grid-four',
	'layout-list': 'list-dashes', library: 'books', lightbulb: 'lightbulb', link: 'link', 'link-2': 'link-simple', list: 'list',
	'list-checks': 'list-checks', 'list-ordered': 'list-numbers', 'list-tree': 'tree-view', lock: 'lock', 'log-out': 'sign-out',
	mail: 'envelope', map: 'map-trifold', maximize: 'arrows-out', 'maximize-2': 'arrows-out-simple', menu: 'list',
	'message-square': 'chat-centered', mic: 'microphone', minimize: 'arrows-in', 'minimize-2': 'arrows-in-simple', minus: 'minus',
	monitor: 'monitor', moon: 'moon', 'more-horizontal': 'dots-three', 'more-vertical': 'dots-three-vertical',
	'notebook-pen': 'notebook', 'notebook': 'notebook', package: 'package', 'panel-left': 'sidebar-simple', 'panel-left-close': 'sidebar-simple',
	'panel-right': 'sidebar', 'panel-right-close': 'sidebar', paperclip: 'paperclip', pause: 'pause', pen: 'pen', 'pen-tool': 'pen-nib',
	pencil: 'pencil-simple', pin: 'push-pin', play: 'play', plus: 'plus', 'plus-circle': 'plus-circle', printer: 'printer',
	quote: 'quotes', 'redo': 'arrow-clockwise', 'redo-2': 'arrow-u-up-right', 'refresh-ccw': 'arrow-counter-clockwise',
	'refresh-cw': 'arrow-clockwise', 'rotate-ccw': 'arrow-counter-clockwise', 'rotate-cw': 'arrow-clockwise', save: 'floppy-disk',
	'fast-forward': 'fast-forward', 'music': 'music-note', 'rewind': 'rewind', 'video': 'video-camera',
	scale: 'scales', scissors: 'scissors', search: 'magnifying-glass', send: 'paper-plane-tilt', 'separator-horizontal': 'rows',
	'separator-vertical': 'columns', settings: 'gear-six', 'settings-2': 'sliders-horizontal', share: 'share-network',
	'share-2': 'share-network', shield: 'shield', 'shield-check': 'shield-check', sidebar: 'sidebar-simple', sliders: 'sliders',
	sparkles: 'sparkle', 'square-pen': 'note-pencil', 'square': 'square', star: 'star', 'sticky-note': 'note', strikethrough: 'text-strikethrough',
	sun: 'sun', table: 'table', tag: 'tag', tags: 'tag', target: 'target', terminal: 'terminal-window', 'text-cursor': 'cursor-text',
	layers: 'stack', 'party-popper': 'confetti', 'plus-with-circle': 'plus-circle',
	timer: 'timer', 'toggle-left': 'toggle-left', 'toggle-right': 'toggle-right', 'trash': 'trash', 'trash-2': 'trash', type: 'text-t',
	underline: 'text-underline', undo: 'arrow-counter-clockwise', 'undo-2': 'arrow-u-up-left', upload: 'upload-simple', user: 'user',
	users: 'users', wand: 'magic-wand', 'wand-2': 'magic-wand', x: 'x', 'x-circle': 'x-circle', zap: 'lightning',
	'zoom-in': 'magnifying-glass-plus', 'zoom-out': 'magnifying-glass-minus',
	'text-select': 'selection-all', 'file-down': 'file-arrow-down', calculator: 'calculator', 'arrow-left-right': 'arrows-left-right', 'x-square': 'x-square', combine: 'arrows-merge', 'list-plus': 'list-plus', 'case-sensitive': 'text-aa', 'arrow-down-wide-narrow': 'sort-descending', 'link-2-off': 'link-break',
};

export function registerBundledIconPacks(): void {
	const weights = phosphor.weights;
	registerIconPack({
		id: 'phosphor',
		name: 'Phosphor',
		weights,
		aliases: LUCIDE_TO_PHOSPHOR,
		get(name, weight) {
			const paths = phosphor.icons[name];
			if (!paths) return null;
			const d = paths[Math.max(0, weights.indexOf(weight))];
			return d ? { viewBox: '0 0 256 256', d } : null;
		},
	});
}

/** For tests: names the alias table points at that the set does not have. */
export function missingAliases(): string[] {
	return Object.entries(LUCIDE_TO_PHOSPHOR).filter(([, p]) => !phosphor.icons[p]).map(([l, p]) => `${l} -> ${p}`);
}
