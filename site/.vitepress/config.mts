import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitepress';

/** The version the download links point at: the app's, as released from this commit. */
const version: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const repo = 'https://github.com/blursedperf/Docketeer';

export default defineConfig({
	title: 'Caselore',
	description: 'Offline Markdown notes for law students: AGLC4 citations, case briefs, flashcards and a keyboard-first Docket. Free for macOS and Linux.',
	lang: 'en-AU',
	base: '/Caselore/',
	cleanUrls: true,
	lastUpdated: true,
	head: [
		['link', { rel: 'icon', type: 'image/png', href: '/Caselore/favicon.png' }],
		// On an iPhone's home screen: the app's own full-bleed icon (iOS rounds it).
		['link', { rel: 'apple-touch-icon', href: '/Caselore/apple-touch-icon.png' }],
		['meta', { property: 'og:title', content: 'Caselore: offline notes for law students' }],
		['meta', { property: 'og:description', content: 'Plain Markdown notes on your own computer, with AGLC4 citations, case briefs, flashcards and a keyboard-first Docket. Nothing goes online.' }],
		['meta', { property: 'og:image', content: 'https://blursedperf.github.io/Docketeer/screenshots/01-main-crisp-light.png' }],
	],
	vite: {
		define: { __VERSION__: JSON.stringify(version) },
	},
	themeConfig: {
		logo: '/logo.png',
		nav: [
			{ text: 'Guide', link: '/guide/getting-started' },
			{ text: 'Privacy', link: '/privacy' },
			{ text: 'Download', link: '/download' },
			{ text: `v${version} beta`, items: [
				{ text: 'What’s new', link: `${repo}/blob/master/CHANGELOG.md` },
				{ text: 'All releases', link: `${repo}/releases` },
			] },
		],
		sidebar: [
			{
				text: 'Start here',
				items: [
					{ text: 'Download and install', link: '/download' },
					{ text: 'Getting started', link: '/guide/getting-started' },
					{ text: 'Keyboard shortcuts', link: '/guide/shortcuts' },
				],
			},
			{
				text: 'Using Caselore',
				items: [
					{ text: 'The Docket', link: '/guide/docket' },
					{ text: 'Writing notes', link: '/guide/writing' },
					{ text: 'Homebases and subjects', link: '/guide/homebases' },
					{ text: 'Panes and layouts', link: '/guide/panes' },
					{ text: 'PDFs and recordings', link: '/guide/sources' },
					{ text: 'Locking notes', link: '/guide/locking' },
					{ text: 'Appearance', link: '/guide/appearance' },
				],
			},
			{
				text: 'For law school',
				items: [
					{ text: 'AGLC4 citations', link: '/guide/aglc4' },
					{ text: 'Flashcards and the timer', link: '/guide/study' },
					{ text: 'Searching outlines', link: '/guide/outlines' },
					{ text: 'Tasks', link: '/guide/tasks' },
				],
			},
			{
				text: 'More',
				items: [
					{ text: 'Privacy', link: '/privacy' },
					{ text: 'Writing plugins', link: '/plugins' },
				],
			},
		],
		socialLinks: [{ icon: 'github', link: repo }],
		search: { provider: 'local' },
		editLink: { pattern: `${repo}/edit/master/site/:path`, text: 'Suggest a change to this page' },
		footer: {
			message: 'Caselore runs entirely offline. This website is the only part of it on the internet.',
			copyright: 'Free and open source, under the MIT licence.',
		},
	},
});
