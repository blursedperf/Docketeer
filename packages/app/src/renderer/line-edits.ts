/**
 * Line edits the keyboard toolbar (and the commands behind it) make: a task on the line, the line's heading level.
 * Pure: a line in, a line out, so they are unit-tested.
 */

/** A list marker, with a task box or without: "  - [ ] ", "- ", "* [x] ". */
const LIST = /^(\s*)([-*+]) (?:\[([ xX])\] )?/;

/** The line as a task: none → open task, open → done, done → open. A plain list item becomes a task. */
export function toggleTask(line: string): string {
	const m = LIST.exec(line);
	if (!m) {
		const indent = /^\s*/.exec(line)![0];
		return `${indent}- [ ] ${line.slice(indent.length)}`;
	}
	const [whole, indent, bullet, box] = m;
	const rest = line.slice(whole.length);
	if (box === undefined) return `${indent}${bullet} [ ] ${rest}`;
	return `${indent}${bullet} [${box === ' ' ? 'x' : ' '}] ${rest}`;
}

/** The line's heading, one level deeper each time: none → # → ## → ### → none. */
export function cycleHeading(line: string): string {
	const m = /^(#{1,6}) /.exec(line);
	const level = m ? m[1]!.length : 0;
	const text = m ? line.slice(m[0].length) : line;
	const next = level >= 3 ? 0 : level + 1;
	return next ? `${'#'.repeat(next)} ${text}` : text;
}
