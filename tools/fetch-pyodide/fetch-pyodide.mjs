// Fetches Pyodide for Toollib into vendor/pyodide and writes vendor/pyodide/toollib-bundle.json.
//   node tools/fetch-pyodide/fetch-pyodide.mjs [version] [--from <folder>]
// Core files come from the npm package (checked against the sha512 the npm registry lists), the packages from
// Pyodide's CDN or, with --from, from an unpacked release (pyodide-<version>.tar.bz2 from GitHub). Every package
// is checked against the sha256 in pyodide-lock.json. Only the packages Toollib needs, with their dependencies.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WANTED = ['numpy', 'scipy', 'matplotlib', 'sympy', 'micropip', 'jedi'];   // micropip, jedi: for Kobra (pip, completion)
const CORE = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'vendor', 'pyodide');
const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const from = fromIdx >= 0 ? args.splice(fromIdx, 2)[1] : null;
const current = existsSync(join(out, 'toollib-bundle.json')) ? JSON.parse(readFileSync(join(out, 'toollib-bundle.json'), 'utf8')).pyodide : null;
const version = args[0] || current;
if (!version) { console.error('Which Pyodide version? e.g. node fetch-pyodide.mjs 314.0.7'); process.exit(1); }

const hash = (algo, buf, enc = 'hex') => createHash(algo).update(buf).digest(enc);
async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 1. npm package: the loader, the Python core and the lock file
console.log(`Pyodide ${version}`);
const meta = await (await fetch(`https://registry.npmjs.org/pyodide/${version}`)).json();
if (!meta.dist) throw new Error(`npm has no pyodide ${version}`);
const tgz = await download(meta.dist.tarball);
const [algo, expected] = meta.dist.integrity.split('-');
if (hash(algo, tgz, 'base64') !== expected) throw new Error('npm package: checksum does not match');
console.log(`  npm package ok (${algo})`);
const tmp = mkdtempSync(join(tmpdir(), 'pyodide-'));
writeFileSync(join(tmp, 'p.tgz'), tgz);
execFileSync('tar', ['-xzf', join(tmp, 'p.tgz'), '-C', tmp]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of CORE) { copyFileSync(join(tmp, 'package', f), join(out, f)); chmodSync(join(out, f), 0o644); }
const lock = JSON.parse(readFileSync(join(out, 'pyodide-lock.json'), 'utf8'));

// 2. the packages Toollib needs and everything they depend on
const names = new Set();
const visit = (n) => {
  if (names.has(n)) return;
  if (!lock.packages[n]) throw new Error(`pyodide-lock.json has no package ${n}`);
  names.add(n);
  for (const d of lock.packages[n].depends || []) visit(d);
};
WANTED.forEach(visit);
for (const n of [...names].sort()) {
  const { file_name: file, sha256 } = lock.packages[n];
  const buf = from ? readFileSync(join(from, file)) : await download(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${file}`);
  if (hash('sha256', buf) !== sha256) throw new Error(`${file}: checksum does not match pyodide-lock.json`);
  writeFileSync(join(out, file), buf);
  console.log(`  ${file} ok`);
}
rmSync(tmp, { recursive: true, force: true });

// 3. what Toollib ships: read by app/services/python.js (packages, sizes) and the Settings card
const files = readdirSync(out).filter((f) => f !== 'toollib-bundle.json').sort()
  .map((name) => ({ name, size: statSync(join(out, name)).size, sha256: hash('sha256', readFileSync(join(out, name))) }));
const bundle = {
  about: 'Pyodide (MPL-2.0, source: https://github.com/pyodide/pyodide) with packages from its release; each wheel carries its own license. Fetched with tools/fetch-pyodide.',
  pyodide: version,
  python: lock.info.python,
  packages: [...names].sort(),
  versions: Object.fromEntries([...names].sort().map((n) => [n, lock.packages[n].version])),
  total: files.reduce((s, f) => s + f.size, 0),
  files,
};
writeFileSync(join(out, 'toollib-bundle.json'), `${JSON.stringify(bundle, null, 1)}\n`);
console.log(`vendor/pyodide: ${files.length} files, ${(bundle.total / 1048576).toFixed(1)} MB`);
if (current && current !== version) console.log(`Now set PYODIDE = '${version}' in sw.js and raise VERSION.`);
