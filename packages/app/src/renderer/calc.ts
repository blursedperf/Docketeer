/**
 * The "/" menu's calculator: arithmetic typed after the slash ("/12*3.5+4", "/(1200-300)/3", "/15% of 80",
 * "/2^10", "/sqrt(2)") is worked out, and the menu offers the answer first. Its own small parser: nothing is
 * evaluated as code.
 *
 *   + - * / (also × ÷ x between numbers)   ^ or ** (power)   ( )   unary -
 *   n%  a hundredth of n ("15%"), and "a% of b"   1,000 (thousands separators)
 *   sqrt abs round floor ceil ln log, pi, e
 */

const FUNCS: Record<string, (x: number) => number> = {
	sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, ln: Math.log, log: Math.log10,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'name'; v: string };

function tokenize(src: string): Tok[] | null {
	const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^').replace(/\bof\b/gi, '*');
	const out: Tok[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i]!;
		if (/\s/.test(c)) { i++; continue; }
		const num = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|^\.\d+/.exec(s.slice(i));
		if (num) { out.push({ t: 'num', v: Number(num[0].replace(/,/g, '')) }); i += num[0].length; continue; }
		const name = /^[a-z]+/i.exec(s.slice(i));
		if (name) {
			const n = name[0].toLowerCase();
			// "x" between numbers is multiplication: "3 x 4".
			if (n === 'x') out.push({ t: 'op', v: '*' });
			else if (n in FUNCS || n in CONSTS) out.push({ t: 'name', v: n });
			else return null;
			i += name[0].length;
			continue;
		}
		if ('+-*/^()%'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
		return null;
	}
	return out;
}

/** The value of `src`, or null when it is not arithmetic Docketeer can work out. */
export function evaluate(src: string): number | null {
	const toks = tokenize(src);
	if (!toks || toks.length === 0) return null;
	let p = 0;
	const peek = () => toks[p];
	const isOp = (v: string) => { const k = peek(); return k?.t === 'op' && k.v === v; };
	const fail = () => { throw new Error('syntax'); };

	// expr := term (('+'|'-') term)*
	const expr = (): number => {
		let v = term();
		while (isOp('+') || isOp('-')) { const op = (toks[p++] as { v: string }).v; const r = term(); v = op === '+' ? v + r : v - r; }
		return v;
	};
	// term := unary (('*'|'/') unary | unary)*   (a number next to a bracket multiplies: "2(3+4)")
	const term = (): number => {
		let v = unary();
		for (;;) {
			if (isOp('*') || isOp('/')) { const op = (toks[p++] as { v: string }).v; const r = unary(); v = op === '*' ? v * r : v / r; }
			else if (isOp('(') || peek()?.t === 'name') v *= power();
			else return v;
		}
	};
	// unary := ('-'|'+') unary | power   (the power first, as usual: -2^2 = -4)
	const unary = (): number => {
		if (isOp('-')) { p++; return -unary(); }
		if (isOp('+')) { p++; return unary(); }
		return power();
	};
	// power := postfix ('^' unary)?   (right to left: 2^3^2 = 2^9; 2^-1 = 0.5)
	const power = (): number => {
		const b = postfix();
		if (isOp('^')) { p++; return b ** unary(); }
		return b;
	};
	// postfix := atom '%'*
	const postfix = (): number => {
		let v = atom();
		while (isOp('%')) { p++; v /= 100; }
		return v;
	};
	const atom = (): number => {
		const k = toks[p++];
		if (!k) return fail();
		if (k.t === 'num') return k.v;
		if (k.t === 'name') {
			if (k.v in CONSTS) return CONSTS[k.v]!;
			if (!isOp('(')) return fail();
			p++;
			const v = FUNCS[k.v]!(expr());
			if (!isOp(')')) return fail();
			p++;
			return v;
		}
		if (k.v === '(') {
			const v = expr();
			if (!isOp(')')) return fail();
			p++;
			return v;
		}
		return fail();
	};
	try {
		const v = expr();
		if (p !== toks.length || !Number.isFinite(v)) return null;
		return v;
	} catch {
		return null;
	}
}

/** Whether `src` is a calculation (an operator or a function), not just a number or a word. */
export function looksLikeMath(src: string): boolean {
	const s = src.trim();
	return /\d/.test(s) && /[-+*/^%×÷()]|\d\s*x\s*\d|\b(sqrt|abs|round|floor|ceil|ln|log)\b|\bof\b/i.test(s) && evaluate(s) !== null;
}

/** A result as it reads: up to 10 significant digits, no trailing zeros, no "-0". */
export function formatNumber(v: number): string {
	if (Object.is(v, -0) || Math.abs(v) < 1e-12) return '0';
	const n = Number(v.toPrecision(10));
	return Math.abs(n) >= 1e15 || Math.abs(n) < 1e-6 ? n.toExponential().replace('e+', 'e') : String(n);
}

/** The working as written out: operators spaced, * and / as × and ÷. */
export function prettyExpression(src: string): string {
	return src.trim()
		.replace(/\*\*/g, '^')
		.replace(/\s*([+*/×÷^])\s*/g, ' $1 ')
		.replace(/([\d)%])\s*-\s*(?=[\d(.a-z])/gi, '$1 - ')
		.replace(/\*/g, '×').replace(/ \/ /g, ' ÷ ')
		.replace(/\s+/g, ' ')
		.trim();
}
