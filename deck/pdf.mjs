// PDF export for the agent-workspaces keynote.
// Usage: bun deck/pdf.mjs --out DIR [--day] [--preview FILE.webp]
// Writes two files:
//   agent-workspaces-slides.pdf  one page per scene, its final beat, full bleed
//   agent-workspaces-guide.pdf   the reader edition: each slide, then its guide (what to say, every beat as a still
//                                beside the paragraph it explains, the steps, the prompt, skills and references)
// Frames come from capture mode (?t=), so they are the same pixels motion-lab verifies.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] };
const DAY = argv.includes('--day'), OUT = path.resolve(arg('--out') || path.join(os.tmpdir(), 'aw-public-pdf'));
mkdirSync(OUT, { recursive: true });
const deck = pathToFileURL(path.join(here, 'index.html')).href, BEAT = 2.5;
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const b = await chromium.launch(), errs = [];
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', e => errs.push(String(e)));
// a second page downsizes beat frames, so the reader edition stays a readable size
const shrink = await b.newPage();
const thumb = buf => shrink.evaluate(async b64 => {
  const im = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob()), c = document.createElement('canvas');
  c.width = 960; c.height = 540; c.getContext('2d').drawImage(im, 0, 0, 960, 540); return c.toDataURL('image/jpeg', .82);
}, buf.toString('base64'));

const scenes = [];
for (let n = 1; ; n++) {
  await page.goto('about:blank');
  await page.goto(`${deck}?t=0${DAY ? '&theme=day' : ''}#scene=${n}`);
  await page.waitForFunction(() => window.__ready === true);
  const meta = await page.evaluate(() => {
    const i = captureScene(), sc = scenes[i];
    return { i, total: N, steps: steps(i), label: sc.getAttribute('aria-label'), act: ACTS[+sc.dataset.act],
      notes: sc.querySelector('aside.notes')?.innerHTML || '', guide: sc.querySelector('template.guide')?.innerHTML || '' };
  });
  if (meta.i !== n - 1) throw new Error(`scene ${n} resolved to ${meta.i + 1}`);
  const shots = [];
  // beats in ascending time on one load: renderAt simulates forward, so each beat costs only its own frames
  for (let k = 0; k < meta.steps; k++) {
    await page.evaluate(t => window.renderAt(t), k * BEAT + (k === meta.steps - 1 ? 3.5 : 2.3));
    await page.waitForTimeout(80);
    shots.push(await page.screenshot({ type: 'jpeg', quality: 86 }));
  }
  scenes.push({ ...meta, n, slide: 'data:image/jpeg;base64,' + shots.at(-1).toString('base64'),
    beats: meta.steps > 1 ? await Promise.all(shots.map(thumb)) : [] });
  process.stdout.write(`\rscene ${n}/${meta.total}, ${meta.steps} beat(s)   `);
  if (n === meta.total) break;
}
console.log();

// the guide's own beat paragraphs carry their still; beats no paragraph names go in a strip under the lead
const placeBeats = s => {
  if (!s.beats.length) return s.guide;
  const named = new Set([...s.guide.matchAll(/data-beat="(\d+)"/g)].map(m => +m[1]));
  const fig = k => `<figure><img src="${s.beats[k]}" alt=""><figcaption>Beat ${k + 1} of ${s.beats.length}</figcaption></figure>`;
  let g = s.guide.replace(/<p data-beat="(\d+)"/g, (m, k) => (s.beats[+k] ? fig(+k) : '') + m);
  const rest = s.beats.map((_, k) => k).filter(k => !named.has(k));
  if (rest.length) g = g.replace(/(<\/p>)/, `$1<div class="strip">${rest.map(fig).join('')}</div>`);
  return g;
};
const font = f => pathToFileURL(path.join(here, 'fonts', f)).href;
// sources table from the speaker script, so the reader edition carries its evidence
const md = readFileSync(path.join(here, '..', 'script.md'), 'utf8');
const src = (md.split('## Sources')[1] || '').split('\n## ')[0].split('\n').filter(l => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l))
  .map(l => l.slice(1, -1).split('|').map(c => esc(c.trim()).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*([^*]+)\*/g, '<i>$1</i>')));
const css = `
@font-face{font-family:Inter;font-weight:300 700;src:url(${font('Inter-400.woff2')})}
@font-face{font-family:Raleway;font-weight:200 600;src:url(${font('Raleway-300.woff2')})}
@font-face{font-family:'JetBrains Mono';font-weight:300 700;src:url(${font('JetBrainsMono-400.woff2')})}
@page{size:1920px 1080px;margin:0}
:root{--deep:oklch(0.155 0.028 250);--surface:oklch(0.205 0.03 245);--t1:oklch(0.975 0.004 250);--t2:oklch(0.83 0.015 248);--t3:oklch(0.65 0.022 248);
 --line:oklch(0.78 0.03 245 / .14);--blue:oklch(0.71 0.15 252);--gold:oklch(0.86 0.12 88)}
:root.day{--deep:oklch(0.975 0.004 250);--surface:oklch(0.94 0.008 250);--t1:oklch(0.22 0.006 260);--t2:oklch(0.42 0.012 255);--t3:oklch(0.55 0.014 255);
 --line:oklch(0.4 0.03 250 / .16);--blue:oklch(0.55 0.18 255);--gold:oklch(0.66 0.13 80)}
html{background:var(--deep);-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:400 19.5px/1.6 Inter,system-ui,sans-serif;color:var(--t2)}
.slide{width:1920px;height:1080px;break-after:page;display:block}
.guide{break-after:page;padding:64px 104px 56px;-webkit-box-decoration-break:clone;box-decoration-break:clone;column-count:3;column-gap:72px;column-rule:1px solid var(--line)}
.gh{column-span:all;margin-bottom:34px;border-bottom:1px solid var(--line);padding-bottom:26px}
.gh span{font:500 15px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--blue)}
.gh h2{font:300 58px/1.08 Raleway,sans-serif;letter-spacing:-.02em;color:var(--t1);margin:16px 0 0}
.lead{font-size:23px;line-height:1.5;color:var(--t1);margin-top:0}
h5{font:500 14px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:var(--t3);margin:30px 0 12px;break-after:avoid}
p{margin:10px 0;orphans:3;widows:3}b{color:var(--t1);font-weight:600}
.say{border-left:2px solid var(--gold);padding:2px 0 2px 18px;margin:18px 0 6px}
.say p{color:var(--t1)}
p[data-beat]{border-left:2px solid var(--blue);padding-left:16px;margin:4px 0 22px}
figure{margin:20px 0 10px;break-inside:avoid}figure img{width:100%;border-radius:10px;border:1px solid var(--line);display:block}
figcaption{font:500 13px/1 'JetBrains Mono',monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--t3);margin-top:9px}
.strip figure{margin:14px 0}
ol,ul{padding-left:26px;margin:8px 0}li{margin:7px 0}
code,kbd{font:400 .84em/1.4 'JetBrains Mono',monospace;color:var(--t1)}
kbd{padding:2px 7px;border:1px solid var(--line);border-radius:6px}
pre.prompt{white-space:pre-wrap;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin:8px 0;break-inside:avoid}
pre.prompt code{font-size:17px;line-height:1.55}
a{color:var(--blue);text-decoration:none}
.src{padding:64px 104px}.src h2{font:300 58px/1.08 Raleway,sans-serif;color:var(--t1);margin:0 0 30px}
table{border-collapse:collapse;width:100%;font-size:17px;line-height:1.45}td,th{text-align:left;vertical-align:top;padding:9px 18px 9px 0;border-bottom:1px solid var(--line)}
td:last-child{white-space:nowrap}
th{font:500 14px/1 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--t3)}`;
const doc = body => `<!doctype html><html class="${DAY ? 'day' : ''}"><head><meta charset="utf-8"><title>The workspace is the product</title><style>${css}</style></head><body>${body}</body></html>`;
const slideOnly = scenes.map(s => `<img class="slide" src="${s.slide}" alt="${esc(s.label)}">`).join('');
const reader = scenes.map(s => `<img class="slide" src="${s.slide}" alt="${esc(s.label)}">` +
  `<section class="guide"><div class="gh"><span>${String(s.n).padStart(2, '0')} / ${s.total} · ${esc(s.act)}</span><h2>${esc(s.label)}</h2></div>` +
  placeBeats(s).replace(/(<p class="lead">[\s\S]*?<\/p>)/, s.notes ? `$1<h5>What to say</h5><div class="say">${s.notes}</div>` : '$1') + `</section>`).join('') +
  (src.length ? `<section class="src"><h2>Sources</h2><table><tr>${src[0].map(c => `<th>${c}</th>`).join('')}</tr>${src.slice(1).map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></section>` : '');

const out = {};
for (const [name, body] of [['slides', slideOnly], ['guide', reader]]) {
  const html = path.join(OUT, `${name}.html`), pdf = path.join(OUT, `agent-workspaces-${name}${DAY ? '-day' : ''}.pdf`);
  writeFileSync(html, doc(body));
  await page.goto(pathToFileURL(html).href); await page.evaluate(() => document.fonts.ready);
  await page.pdf({ path: pdf, width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
  out[name] = { pdf, mb: +(statSync(pdf).size / 2 ** 20).toFixed(1) };
}
if (arg('--preview')) {
  await page.goto(`${deck}?t=0&theme=&tone=midnight#scene=1`);
  await page.waitForFunction(() => window.__ready === true);
  await page.evaluate(() => window.renderAt((steps(0)-1)*2.5+3.5));
  const png = await page.screenshot();
  const webp = await shrink.evaluate(async b64 => {
    const im = await createImageBitmap(await (await fetch('data:image/png;base64,'+b64)).blob());
    const c = document.createElement('canvas'); c.width=1920; c.height=1080;
    c.getContext('2d').drawImage(im,0,0); return c.toDataURL('image/webp',.9).split(',')[1];
  }, png.toString('base64'));
  writeFileSync(path.resolve(arg('--preview')), Buffer.from(webp,'base64'));
}
await b.close();
console.log(JSON.stringify({ scenes: scenes.length, beats: scenes.reduce((a, s) => a + s.steps, 0), errors: errs.length, out }, null, 1));
if (errs.length) { console.error(errs.slice(0, 5)); process.exit(1) }
