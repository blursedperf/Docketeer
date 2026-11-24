import { describe, expect, it } from 'vitest';
import { eventString } from '../src/keymap';
import { formatTimestamp, mediaKind, nextSpeed, parseTimestamp, timeFromSubpath } from '../src/media';

describe('mediaKind', () => {
	it('knows video and audio by extension, whatever the case, ignoring a #subpath', () => {
		expect(mediaKind('Lectures/Week 3.mp4')).toBe('video');
		expect(mediaKind('Week 3.MOV')).toBe('video');
		expect(mediaKind('Week 3.webm#t=12:34')).toBe('video');
		expect(mediaKind('Week 3.m4a')).toBe('audio');
		expect(mediaKind('interview.wav')).toBe('audio');
	});
	it('is null for anything else', () => {
		for (const n of ['Note.md', 'Brief.pdf', 'picture.png', 'mp4', 'Week 3.vtt', '']) expect(mediaKind(n), n).toBeNull();
	});
});

describe('timestamps', () => {
	it('parses seconds, m:ss and h:mm:ss', () => {
		expect(parseTimestamp('754')).toBe(754);
		expect(parseTimestamp('12:34')).toBe(754);
		expect(parseTimestamp('0:05')).toBe(5);
		expect(parseTimestamp('1:02:03')).toBe(3723);
		expect(parseTimestamp('12:34.5')).toBe(754.5);
		expect(parseTimestamp(' 2:00 ')).toBe(120);
	});
	it('refuses what is not a time', () => {
		for (const s of ['', '1:75', '1:60:00', '12:', ':30', 'abc', '1:2:3:4', '-5', '1h2m']) expect(parseTimestamp(s), s).toBeNull();
	});
	it('formats whole seconds as m:ss, or h:mm:ss from an hour', () => {
		expect(formatTimestamp(0)).toBe('0:00');
		expect(formatTimestamp(5.9)).toBe('0:05');
		expect(formatTimestamp(754)).toBe('12:34');
		expect(formatTimestamp(3723)).toBe('1:02:03');
		expect(formatTimestamp(-3)).toBe('0:00');
		expect(formatTimestamp(Number.NaN)).toBe('0:00');
	});
	it('round-trips', () => {
		for (const t of [0, 59, 60, 754, 3599, 3600, 3723, 36000]) expect(parseTimestamp(formatTimestamp(t))).toBe(t);
	});
	it('reads the time from a link subpath', () => {
		expect(timeFromSubpath('#t=12:34')).toBe(754);
		expect(timeFromSubpath('#t=90')).toBe(90);
		expect(timeFromSubpath('#t=1:00&slide=7')).toBe(60);
		expect(timeFromSubpath('#Heading')).toBeNull();
		expect(timeFromSubpath('')).toBeNull();
		expect(timeFromSubpath('#t=soon')).toBeNull();
	});
});

describe('playback speed', () => {
	it('steps through the speeds and stops at the ends', () => {
		expect(nextSpeed(1, 1)).toBe(1.25);
		expect(nextSpeed(1, -1)).toBe(0.75);
		expect(nextSpeed(3, 1)).toBe(3);
		expect(nextSpeed(0.5, -1)).toBe(0.5);
		expect(nextSpeed(1.1, 1)).toBe(1.25);
		expect(nextSpeed(1.1, -1)).toBe(1);
	});
});

describe('Option+letter on macOS', () => {
	it('matches the letter, not the symbol it types', () => {
		const ev = (key: string, code: string) => ({ altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, key, code });
		expect(eventString(ev('˚', 'KeyK'))).toBe('Alt+K');
		expect(eventString(ev('†', 'KeyT'))).toBe('Alt+T');
		expect(eventString(ev('Dead', 'KeyE'))).toBe('Alt+E');
		expect(eventString(ev('k', 'KeyK'))).toBe('Alt+K');
		expect(eventString(ev('≤', 'Comma'))).toBe('Alt+,');
	});
});
