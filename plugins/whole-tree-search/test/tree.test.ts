import * as assert from "assert";
import { displayLine, queryWords, searchTree } from "../src/tree";

const notes = [
	"# Negligence",
	"",
	"- Duty of care",
	"\t- Donoghue v Stevenson",
	"\t\t- snail in the bottle",
	"\t- Caparo test",
	"- Breach",
	"\t- standard of care",
	"\t\t- Wyong v Shirt",
	"",
	"## Causation",
	"- But-for test",
	"\t- breach must cause the damage",
].join("\n");

const shape = (m: ReturnType<typeof searchTree>[number]) => m.lines.map((l) => `${"·".repeat(l.depth)}${l.match ? "*" : ""}${l.text}`);

// Words: split on spaces, lowercased unless case matters, each once.
assert.deepStrictEqual(queryWords("  Duty  duty CARE "), ["duty", "care"]);
assert.deepStrictEqual(queryWords("Duty duty", true), ["Duty", "duty"]);
assert.strictEqual(displayLine("\t\t- [ ] call client"), "[ ] call client");
assert.strictEqual(displayLine("## Causation ##"), "Causation");
assert.strictEqual(displayLine("  12. twelfth"), "twelfth");

// One word: the heading above, the parent, the line found and everything under it, with the word marked.
{
	const [m, ...rest] = searchTree(notes, "donoghue");
	assert.strictEqual(rest.length, 0);
	assert.strictEqual(m!.line, 3);
	assert.strictEqual(m!.whole, true);
	assert.deepStrictEqual(shape(m!), ["Negligence", "·Duty of care", "··*Donoghue v Stevenson", "···snail in the bottle"]);
	assert.deepStrictEqual(m!.lines[2]!.ranges, [[0, 8]]);
}

// Words match where a word starts: "care" is not found inside "scared"; prefixes are.
assert.strictEqual(searchTree("- scared", "care").length, 0);
assert.strictEqual(searchTree("- Caparo", "cap").length, 1);

// Spread down a branch: "breach" under "Negligence"? No: under the heading "Causation" with "but-for".
{
	const ms = searchTree(notes, "causation breach");
	assert.deepStrictEqual(ms.map((m) => m.line), [12]);
	assert.strictEqual(ms[0]!.whole, false);
	assert.deepStrictEqual(shape(ms[0]!), ["Causation", "·But-for test", "··*breach must cause the damage"]);
}
// A parent holding one word, children the other: each child is a match, the parent is not listed for each.
{
	const ms = searchTree(notes, "duty caparo");
	assert.deepStrictEqual(ms.map((m) => m.line), [5]);
	const both = searchTree("- duty\n\t- breach one\n\t- breach two\n\t\t- breach deeper", "duty breach");
	assert.deepStrictEqual(both.map((m) => m.line), [1, 2]);
}
// Every word on one line still comes first in its own right; a word in no part of the branch finds nothing.
assert.deepStrictEqual(searchTree(notes, "standard care").map((m) => [m.line, m.whole]), [[7, true]]);
assert.strictEqual(searchTree(notes, "duty wyong").length, 0);

// Options: no heading, no children, ancestors to the root, frontmatter, case, limit.
{
	const [m] = searchTree(notes, "wyong", { showHeading: false, ancestorLevels: 9 });
	assert.deepStrictEqual(shape(m!), ["Breach", "·standard of care", "··*Wyong v Shirt"]);
	const [n] = searchTree(notes, "donoghue", { includeChildren: false, ancestorLevels: 0 });
	assert.deepStrictEqual(shape(n!), ["Negligence", "·*Donoghue v Stevenson"]);
	const fm = "---\ntags: duty\n---\n- duty";
	assert.deepStrictEqual(searchTree(fm, "duty").map((x) => x.line), [1, 3]);
	assert.deepStrictEqual(searchTree(fm, "duty", { skipFrontmatter: true }).map((x) => x.line), [3]);
	assert.strictEqual(searchTree(notes, "Duty", { caseSensitive: true }).length, 1);
	assert.strictEqual(searchTree(notes, "care", { limit: 1 }).length, 1);
}
// Headings inside a code block are not headings.
{
	const [m] = searchTree("# Real\n```\n# not a heading\n```\n- item", "item");
	assert.strictEqual(m!.lines[0]!.text, "Real");
}
