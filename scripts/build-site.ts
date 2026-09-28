// Builds the static site into site/: bundles the page with the same engine the tests run.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { loadSources } from '../src/sources-node.ts';
import { pinnedDrafts, BATCH } from '../src/pinned-node.ts';

const root = new URL('../', import.meta.url);
const p = (x: string) => new URL(x, root).pathname;
mkdirSync(p('web/generated'), { recursive: true });
mkdirSync(p('site'), { recursive: true });
const s = loadSources();
writeFileSync(p('web/generated/sources.json'), JSON.stringify(s));
writeFileSync(p('web/generated/pinned.json'), JSON.stringify(pinnedDrafts(s)));
const ev = JSON.parse(readFileSync(p(`data/results/eval_${BATCH}.json`), 'utf8'));
const adj = JSON.parse(readFileSync(p(`data/results/adjudication_${BATCH}.json`), 'utf8'));
writeFileSync(p('web/generated/results.json'), JSON.stringify({
  natural: { ...ev.natural, perDraft: undefined },
  corrupted: { cases: ev.corrupted.cases, failed: ev.corrupted.failed, toReviewer: ev.corrupted.toReviewer, passed: ev.corrupted.passed, byType: ev.corrupted.byType },
  adjudication: { realErrors: adj.realErrors, realSummary: adj.realSummary, falseSummary: adj.falseSummary },
  repo: process.env.REPO_URL ?? 'https://github.com/fred1433/agency-pack-check',
}));
await build({
  entryPoints: [p('web/app.ts')], bundle: true, format: 'esm', platform: 'browser', target: 'es2020', minify: true,
  outfile: p('site/app.js'), loader: { '.json': 'json' }, logLevel: 'warning',
});
for (const f of ['index.html', 'styles.css']) copyFileSync(p(`web/${f}`), p(`site/${f}`));
const fav = '/Users/frederic/ProjetsDev/the-ai-pipe-website/website/public/';
for (const f of ['favicon.svg', 'favicon.png']) copyFileSync(fav + f, p(`site/${f}`));
writeFileSync(p('site/_headers'), '/agency-pack/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n');
writeFileSync(p('site/robots.txt'), 'User-agent: *\nDisallow: /\n');
// Served under theaipipe.com/agency-pack/ by a Worker with static assets (the zone has no room for a subdomain).
mkdirSync(p('deploy/agency-pack'), { recursive: true });
for (const f of ['index.html', 'styles.css', 'app.js', 'favicon.svg', 'favicon.png']) copyFileSync(p(`site/${f}`), p(`deploy/agency-pack/${f}`));
writeFileSync(p('deploy/_headers'), '/agency-pack/*\n  X-Robots-Tag: noindex, nofollow\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Content-Type-Options: nosniff\n');
console.log('site built');
