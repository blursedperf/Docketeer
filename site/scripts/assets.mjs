// Copies the app's screenshots into the site, so its pictures are the ones CI keeps up to date (test/visual/linux).
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(site, '..', 'test', 'visual', 'linux');
const to = join(site, 'public', 'screenshots');
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const shots = readdirSync(from).filter((f) => f.endsWith('.png'));
for (const f of shots) cpSync(join(from, f), join(to, f));
console.log(`Copied ${shots.length} screenshots into public/screenshots`);
