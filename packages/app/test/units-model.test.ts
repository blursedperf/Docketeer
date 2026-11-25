import { describe, expect, it } from 'vitest';
import { deleteUnitTags, parseUnitTags, renameUnitTags, suggestedUnitTags, taggedParent, unitChildren, unitRoots } from '../src/renderer/units-model';

const tags = { 'Torts': 'subject', 'Torts/Negligence': 'topic', 'Torts/Negligence/Duty': 'topic', 'Uni/2026/Contracts': 'subject', 'Loose topic': 'topic' } as const;

describe('unit tags', () => {
	it('reads the file, dropping what is not a subject or topic', () => {
		expect(parseUnitTags('{"Torts":"subject","Torts/Negligence":"topic","Odd":"client","":"subject"}')).toEqual({ Torts: 'subject', 'Torts/Negligence': 'topic' });
		expect(parseUnitTags('not json')).toEqual({});
		expect(parseUnitTags('[1,2]')).toEqual({});
	});
	it('finds the nearest tagged folder above, whatever lies between', () => {
		expect(taggedParent(tags, 'Torts/Negligence/Duty')).toBe('Torts/Negligence');
		expect(taggedParent(tags, 'Torts/Untagged/Deep')).toBe('Torts');
		expect(taggedParent(tags, 'Uni/2026/Contracts')).toBeNull();
	});
	it('puts folders with nothing tagged above them at the top, and the rest under their nearest', () => {
		expect(unitRoots(tags).sort()).toEqual(['Loose topic', 'Torts', 'Uni/2026/Contracts']);
		expect(unitChildren(tags, 'Torts')).toEqual(['Torts/Negligence']);
		expect(unitChildren(tags, 'Torts/Negligence')).toEqual(['Torts/Negligence/Duty']);
	});
	it('follows a folder renamed or moved, with the folders inside it, and drops a deleted one', () => {
		expect(renameUnitTags(tags, 'Torts', 'Law of Torts')).toEqual({ 'Law of Torts': 'subject', 'Law of Torts/Negligence': 'topic', 'Law of Torts/Negligence/Duty': 'topic', 'Uni/2026/Contracts': 'subject', 'Loose topic': 'topic' });
		expect(renameUnitTags(tags, 'Tort', 'X')).toEqual(tags);
		expect(deleteUnitTags(tags, 'Torts/Negligence')).toEqual({ 'Torts': 'subject', 'Uni/2026/Contracts': 'subject', 'Loose topic': 'topic' });
	});
	it('suggests what Units showed before tags: top folders as subjects, folders in them as topics', () => {
		const folders = ['Torts', 'Torts/Negligence', 'Torts/Negligence/Deep', 'attachments', 'attachments/x', 'Archive', 'Archive/Old', '.hidden', 'Contracts'];
		const skip = (p: string) => p === 'attachments' || p === 'Archive' || p.startsWith('Archive/');
		expect(suggestedUnitTags(folders, skip)).toEqual({ Torts: 'subject', 'Torts/Negligence': 'topic', Contracts: 'subject' });
	});
});
