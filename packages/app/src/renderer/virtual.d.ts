declare module 'virtual:phosphor-icons' {
	/** Generated at build time from @phosphor-icons/core: one path per icon and weight. */
	const data: { weights: string[]; icons: Record<string, string[]> };
	export default data;
}

declare module 'pdfjs-dist/build/pdf.worker.mjs' {
	/** pdf.js's parser, run on the page's own thread (see pdf/engine.ts). */
	export const WorkerMessageHandler: unknown;
}
