<script setup lang="ts">
// Download buttons for the release this site was built with. The visitor's system (guessed from the browser) comes
// first; every other download is listed under it. Nothing is fetched: the links are worked out at build time.
import { computed, onMounted, ref } from 'vue';

declare const __VERSION__: string;
declare const __ASSET_NAME__: string;
const v = __VERSION__;
/** The installers' name for this version (Docketeer up to 0.25.4). */
const n = __ASSET_NAME__;
const base = `https://github.com/blursedperf/caselore/releases/download/v${v}`;

interface Download { os: 'mac' | 'linux'; label: string; detail: string; file: string }
const downloads: Download[] = [
	{ os: 'mac', label: 'macOS (Apple Silicon)', detail: 'M1 or later · .dmg', file: `${n}-${v}-mac-arm64.dmg` },
	{ os: 'mac', label: 'macOS (Intel)', detail: 'Older Macs · .dmg', file: `${n}-${v}-mac-x64.dmg` },
	{ os: 'linux', label: 'Linux AppImage', detail: 'Any distribution · x86-64', file: `${n}-${v}-linux-x86_64.AppImage` },
	{ os: 'linux', label: 'Debian / Ubuntu', detail: '.deb · x86-64', file: `${n}-${v}-linux-amd64.deb` },
	{ os: 'linux', label: 'Arch / Omarchy', detail: '.pacman · x86-64', file: `${n}-${v}-linux-x64.pacman` },
	{ os: 'linux', label: 'Linux AppImage (ARM)', detail: 'arm64', file: `${n}-${v}-linux-arm64.AppImage` },
	{ os: 'linux', label: 'Debian / Ubuntu (ARM)', detail: '.deb · arm64', file: `${n}-${v}-linux-arm64.deb` },
	{ os: 'linux', label: 'Arch (ARM)', detail: '.pacman · arm64', file: `${n}-${v}-linux-aarch64.pacman` },
];

const os = ref<'mac' | 'linux' | 'other'>('other');
onMounted(() => {
	const ua = navigator.userAgent;
	os.value = /Mac OS X|Macintosh/.test(ua) && !/iPhone|iPad/.test(ua) ? 'mac' : /Linux/.test(ua) && !/Android/.test(ua) ? 'linux' : 'other';
});
const primary = computed(() => downloads.filter((d) => d.os === os.value).slice(0, os.value === 'mac' ? 2 : 1));
const rest = computed(() => downloads.filter((d) => !primary.value.includes(d)));
</script>

<template>
	<div class="dl">
		<p v-if="os === 'other'" class="dl-note">Caselore is for macOS and Linux. Windows and iPhone are not available yet.</p>
		<div class="dl-primary">
			<a v-for="d in primary" :key="d.file" class="dl-button" :href="`${base}/${d.file}`">
				<span class="dl-label">Download for {{ d.label }}</span>
				<span class="dl-detail">{{ d.detail }}</span>
			</a>
		</div>
		<details class="dl-more" :open="os === 'other'">
			<summary>Other downloads</summary>
			<ul>
				<li v-for="d in rest" :key="d.file"><a :href="`${base}/${d.file}`">{{ d.label }}</a> <span>{{ d.detail }}</span></li>
				<li><a :href="`${base}/SHA256SUMS.txt`">Checksums</a> <span>SHA-256, to check a download</span></li>
			</ul>
		</details>
		<p class="dl-version">Version {{ v }} · free and open source · no account, no internet needed</p>
	</div>
</template>

<style scoped>
.dl { margin: 24px 0; }
.dl-primary { display: flex; flex-wrap: wrap; gap: 12px; }
.dl-button {
	display: flex; flex-direction: column; padding: 12px 20px; border-radius: 8px;
	background: var(--vp-c-brand-3); color: var(--vp-c-white); text-decoration: none; transition: background 0.2s;
}
.dl-button:hover { background: var(--vp-c-brand-2); }
.dl-label { font-weight: 600; }
.dl-detail { font-size: 13px; opacity: 0.85; }
.dl-more { margin-top: 16px; }
.dl-more summary { cursor: pointer; color: var(--vp-c-text-2); }
.dl-more ul { margin-top: 8px; }
.dl-more span, .dl-version, .dl-note { color: var(--vp-c-text-2); font-size: 14px; }
.dl-version { margin-top: 12px; }
</style>
