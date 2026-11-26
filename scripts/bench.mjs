#!/usr/bin/env node
/*
 * Performance budgets with 10,000 notes: writes the generated homebase to a temporary folder, runs Docketeer
 * on it offscreen (--bench) and prints the timings. Run after a build: npm run bench
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture } from './fixture.mjs';

const count = Number(process.argv[2]) || 10000;
const root = mkdtempSync(join(tmpdir(), 'quire-bench-'));
const dir = join(root, 'Bench');
for (const n of makeFixture(count)) { mkdirSync(dirname(join(dir, n.path)), { recursive: true }); writeFileSync(join(dir, n.path), n.text); }
const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'app');
const args = ['electron', '.', '--bench', `--homebase=${dir}`];
const xvfb = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const r = spawnSync(xvfb ? 'xvfb-run' : 'npx', xvfb ? ['-a', 'npx', ...args] : args, { cwd: appDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
rmSync(root, { recursive: true, force: true });
const m = /QUIRE_SMOKE (\{[\s\S]*\})/.exec(r.stdout ?? '');
if (!m) { console.error(r.stdout, r.stderr); process.exit(1); }
const report = JSON.parse(m[1]);
console.log(`Benchmark: ${count} notes`);
for (const c of report.checks ?? []) console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
process.exit(report.ok ? 0 : 1);
