// Token Radar: a program/v1 entry for make.fun's token-radar-01 competition.
//
// Reads the sealed snapshot (from /input/snapshot.json in the grader, or --input
// <snapshot.json|directory> anywhere else), scores every pre-token protocol with the
// model in lib/model.ts, and writes the entry's outputs:
//
//   board.json     the ranked board, watchlist covered, farm plan per row
//   data.js        the dashboard's dataset, beside the page
//   dashboard/     the static page (copied from this repository)
//   screenshots/   three real renders of the page (copied from this repository)
//   dossier.json   the judge's summary, written by the vendored make.fun library
//
// Node 22 standard library only, no network, deterministic: the same snapshot bytes
// always produce the same output bytes. Outside the grader, MAKEFUN_OUTPUT_DIR stands
// in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/** The dossier text cap and the scorer's screenshot caps, as the rules state them. */
const DOSSIER_TEXT_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };

/** A dossier-legal file name: a letter, digit or underscore first, then letters, digits, . _ -. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--flag <value>` or `--flag=<value>`, or `fallback` when the flag is absent. */
function flagValue(flag: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${flag}` && i + 1 < args.length) return args[i + 1]!;
    if (args[i]!.startsWith(`--${flag}=`)) return args[i]!.slice(flag.length + 3);
  }
  return fallback;
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const outputDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/**
 * Copy a directory tree of regular files into `dest`, skipping dot-names and anything
 * that is not a regular file. Returns the copied paths, relative to the source root,
 * in deterministic order.
 */
function copyTree(source: string, dest: string, prefix = ''): string[] {
  const copied: string[] = [];
  if (!existsSync(source)) return copied;
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(source, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const from = join(source, entry.name);
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      copied.push(...copyTree(from, join(dest, entry.name), rel));
    } else if (entry.isFile() && statSync(from).isFile()) {
      copyFileSync(from, join(dest, entry.name));
      copied.push(rel);
    }
  }
  return copied;
}

const dashboardFiles = copyTree(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashboardFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file: the gate needs a stylesheet beside the page');
if (!dashboardFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file: the gate needs a script beside the page');
const shotFiles = copyTree(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shotFiles.length < 3) {
  fail(`screenshots/ holds ${shotFiles.length} image(s): hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shotFiles) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: names are 1..128 letters, digits and . _ -, not starting with . or -`);
}

// The dossier is written last, from the finished /output: the scorer rebuilds it from
// the same directory and compares the bytes.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_BYTES, screenshots: SCREENSHOT_LIMIT, dashboard: DASHBOARD_LIMIT }),
);

process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols read, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), screenshots/ (${shotFiles.length} images), dossier.json into ${outputDir}\n`,
);
