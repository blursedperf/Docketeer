/**
 * Legal terms general English dictionaries lack, accepted by the spellchecker when "Legal terms" is on:
 * Latin phrases (as single words, since words are checked one at a time), AGLC citation abbreviations,
 * jurisdiction and court abbreviations in mixed case (all-capitals words are not checked anyway), and
 * legal vocabulary. Caselore's own list (MIT). Lower-case entries also accept a capitalised first letter.
 */
export const LEGAL_WORDS: string[] = [
	// Latin and law French
	'ab', 'initio', 'inter', 'alia', 'alios', 'obiter', 'dicta', 'dictum', 'ratio', 'rationes', 'decidendi', 'stare', 'decisis',
	'terra', 'nullius', 'res', 'judicata', 'ultra', 'vires', 'intra', 'bona', 'fide', 'fides', 'mala', 'mens', 'rea', 'actus', 'reus',
	'habeas', 'corpus', 'certiorari', 'mandamus', 'quo', 'warranto', 'sui', 'generis', 'ejusdem', 'noscitur', 'sociis',
	'expressio', 'unius', 'exclusio', 'alterius', 'nemo', 'dat', 'quod', 'habet', 'pari', 'materia', 'curiam', 'incuriam',
	'prima', 'facie', 'tanto', 'rata', 'bono', 'nunc', 'tunc', 'amicus', 'curiae', 'parte', 'facto', 'jure', 'novo', 'functus',
	'officio', 'lex', 'loci', 'situs', 'contractus', 'delicti', 'conveniens', 'lis', 'pendens', 'nisi', 'sine', 'qua', 'subpoena',
	'subpoenas', 'duces', 'tecum', 'volenti', 'fit', 'injuria', 'damnum', 'absque', 'novus', 'interveniens', 'causa', 'causam',
	'utere', 'tuo', 'alienum', 'laedas', 'audi', 'alteram', 'partem', 'mutatis', 'mutandis', 'quantum', 'meruit', 'valebant',
	'restitutio', 'integrum', 'seriatim', 'simpliciter', 'vivos', 'mortis', 'donatio', 'parens', 'patriae', 'locus', 'standi',
	'idem', 'infra', 'supra', 'passim', 'viz', 'semble', 'sub', 'judice', 'nolle', 'prosequi', 'autrefois', 'acquit', 'convict',
	'doli', 'incapax', 'capax', 'quasi', 'qui', 'tam', 'scintilla', 'animus', 'contrahendi', 'nudum', 'pactum', 'consensus',
	'ad', 'idem', 'hoc', 'litem', 'hominem', 'colore', 'officii', 'estoppel', 'estoppels', 'estopped', 'cestui', 'que',
	'chose', 'choses', 'profit', 'prendre', 'cy', 'pres', 'seisin', 'seised', 'fee', 'simple', 'demesne', 'escheat',
	'mesne', 'laches', 'per', 'incuriam', 'stricto', 'sensu', 'lato', 'contra', 'proferentem', 'proferentes', 'caveat', 'emptor',
	'caveats', 'caveator', 'caveatee', 'quantum', 'valebat', 'non', 'est', 'factum', 'sic', 'et', 'al', 'seq', 'ibid',

	// AGLC citation abbreviations
	'eg', 'ie', 'cf', 'cl', 'cll', 'pt', 'pts', 'div', 'divs', 'sch', 'schs', 'reg', 'regs', 'ss', 'subs', 'para', 'paras',
	'subpara', 'subparas', 'fn', 'fns', 'ch', 'chs', 'vol', 'vols', 'ed', 'eds', 'edn', 'trans', 'art', 'arts', 'annex',
	'app', 'apps', 'pl', 'pls', 'rr', 'ord', 'ords', 'sr', 'ibid', 'ff',

	// Jurisdictions, courts and report series in mixed case
	'Cth', 'Qld', 'Vic', 'Tas', 'Austl', 'Ch', 'QdR', 'Qd', 'StR', 'Tas', 'LGERA', 'Cr', 'Ct', 'Ltd', 'Pty', 'Inc', 'Corp',
	'Parl', 'Hansard', 'Deb', 'Comm', 'Cmnd', 'Cmd', 'Cm', 'Gaz', 'Sess',

	// Legal vocabulary
	'extinguishment', 'extinguishments', 'justiciable', 'justiciability', 'nonjusticiable', 'non-justiciable',
	'indefeasibility', 'indefeasible', 'defeasible', 'defeasance', 'subrogation', 'subrogated', 'tortfeasor', 'tortfeasors',
	'tortious', 'tortiously', 'unconscionability', 'mortgagee', 'mortgagees', 'mortgagor', 'mortgagors', 'bailee', 'bailees',
	'bailor', 'bailors', 'chattel', 'chattels', 'enforceability', 'severability', 'severable', 'appellant', 'appellants',
	'interlocutory', 'curial', 'extracurial', 'justiciably', 'nonfeasance', 'misfeasance', 'malfeasance', 'pleadings',
	'amicus', 'certiorari', 'promisor', 'promisors', 'promisee', 'promisees', 'offeror', 'offerors', 'offeree', 'offerees',
	'obligor', 'obligee', 'assignor', 'assignee', 'transferor', 'transferee', 'vendor', 'vendee', 'lessor', 'lessee',
	'licensor', 'licensee', 'testator', 'testatrix', 'testators', 'intestacy', 'intestate', 'legatee', 'legatees', 'devisee',
	'devisees', 'probate', 'equitable', 'fiduciaries', 'fiduciary', 'unenforceability', 'rescission', 'rescissory',
	'restitutionary', 'unjust', 'quistclose', 'Torrens', 'native', 'proprietorship', 'proprietary', 'leasehold', 'freehold',
	'pastoral', 'usufructuary', 'sui', 'jus', 'jura', 'novation', 'novated', 'remoteness', 'foreseeability', 'foreseeable',
	'contributory', 'apportionment', 'quantum', 'adjudicative', 'adjudicator', 'adjudicators', 'arbitral', 'arbitrability',
	'recusal', 'recuse', 'recused', 'deponent', 'deponents', 'affiant', 'adjournments', 'adducing', 'adduce', 'adduced',
	'inculpatory', 'exculpatory', 'voir', 'dire', 'prosecutorial', 'sentencing', 'recidivism', 'parliamentary', 'statutorily',
	'unconstitutionally', 'Westminster', 'Chapter', 'Commonwealth', 'Hansard', 'Senate', 'senator', 'senators',
	'Aboriginal', 'Torres', 'Strait', 'Islander', 'Islanders', 'dispossession', 'traditional', 'owners',
];
