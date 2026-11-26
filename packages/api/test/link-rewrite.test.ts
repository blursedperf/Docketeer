import { describe, expect, it } from 'vitest';
import { applyLinkEdits, rewriteLink } from '../src/link-rewrite';

describe('rewriting links to a renamed file', () => {
	it('recordings and pictures: the name keeps its extension', () => {
		expect(rewriteLink('![[clip.mp4]]', 'media/clip.mp4', 'media/lecture.mp4', 'Notes/Week 1.md')).toBe('![[lecture.mp4]]');
		expect(rewriteLink('![[clip.mp4|400]]', 'media/clip.mp4', 'media/lecture.mp4', 'a.md')).toBe('![[lecture.mp4|400]]');
		expect(rewriteLink('![[media/clip.mp4]]', 'media/clip.mp4', 'video/clip.mp4', 'a.md')).toBe('![[video/clip.mp4]]');
	});
	it('notes: ".md" only when it was written; subpath and alias kept', () => {
		expect(rewriteLink('[[Duty]]', 'Torts/Duty.md', 'Torts/Duty of care.md', 'a.md')).toBe('[[Duty of care]]');
		expect(rewriteLink('[[Duty#Ratio|the duty]]', 'Torts/Duty.md', 'Torts/Care.md', 'a.md')).toBe('[[Care#Ratio|the duty]]');
		expect(rewriteLink('[[Torts/Duty]]', 'Torts/Duty.md', 'Negligence/Duty.md', 'a.md')).toBe('[[Negligence/Duty]]');
		expect(rewriteLink('[[Duty.md]]', 'Duty.md', 'Care.md', 'a.md')).toBe('[[Care.md]]');
		expect(rewriteLink('[[v1.2 notes]]', 'v1.2 notes.md', 'v1.3 notes.md', 'a.md')).toBe('[[v1.3 notes]]');
	});
	it('Markdown links: encoded stays encoded, relative stays relative', () => {
		expect(rewriteLink('![](media/My%20clip.mp4)', 'media/My clip.mp4', 'media/Your clip.mp4', 'a.md')).toBe('![](media/Your%20clip.mp4)');
		expect(rewriteLink('[x](../media/clip.mp4 "t")', 'media/clip.mp4', 'media/new.mp4', 'Notes/a.md')).toBe('[x](../media/new.mp4 "t")');
		expect(rewriteLink('[x](clip.mp4)', 'Notes/clip.mp4', 'Notes/talk.mp4', 'Notes/a.md')).toBe('[x](talk.mp4)');
		expect(rewriteLink('![](clip.mp4)', 'clip.mp4', 'my talk.mp4', 'a.md')).toBe('![](my%20talk.mp4)');
	});
	it('a note that moved with its folder writes relative links from its new place', () => {
		expect(rewriteLink('[x](./clip.mp4)', 'A/clip.mp4', 'B/clip.mp4', 'B/n.md', 'A/n.md')).toBe('[x](clip.mp4)');
		expect(rewriteLink('[x](./clip.mp4)', 'A/clip.mp4', 'C/clip.mp4', 'A/n.md')).toBe('[x](../C/clip.mp4)');
	});
	it('applies edits at their place, or wherever the text moved to', () => {
		const text = 'See ![[a.mp4]] and ![[a.mp4]].';
		expect(applyLinkEdits(text, [{ from: 4, to: 14, original: '![[a.mp4]]', insert: '![[b.mp4]]' }, { from: 19, to: 29, original: '![[a.mp4]]', insert: '![[b.mp4]]' }])).toBe('See ![[b.mp4]] and ![[b.mp4]].');
		expect(applyLinkEdits(`Added. ${text}`, [{ from: 4, to: 14, original: '![[a.mp4]]', insert: '![[b.mp4]]' }])).toBe('Added. See ![[b.mp4]] and ![[b.mp4]].');
	});
});
