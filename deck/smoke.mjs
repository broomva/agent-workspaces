// Browser smoke test for the agent-workspaces keynote.
// Usage: bun run smoke (optional PLAYWRIGHT_DIR points to a compatible local install)
// Checks: every scene and beat runs without an error; reduced motion paints a non-empty still frame per scene;
// narration highlights the current beat; capture mode (?t=) is byte-identical across paint orders.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');
const deck = pathToFileURL(path.join(here, 'index.html')).href;
const fails = [];
const browser = await chromium.launch();
const page = async (url, opts = {}) => { const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, ...opts }); const errs = []; p.on('pageerror', (e) => errs.push(String(e))); await p.goto(url); return { p, errs }; };

// 1. every scene and beat, live mode
{ const { p, errs } = await page(deck + '#scene=1&beat=0');
  await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const r = await p.evaluate(() => { const bad = []; for (let i = 0; i < N; i++) for (let s = 0; s < steps(i); s++) { try { go(i, s); for (let n = 0; n < 20; n++) { T0 += 1 / 60; domFrame(1 / 60); paint(1 / 60) } } catch (e) { bad.push(`${scenes[i].dataset.id}:${s} ${e.message}`) } } return { n: N, bad }; });
  if (r.bad.length || errs.length) fails.push(`scene sweep: ${[...r.bad, ...errs].join('; ')}`);
  console.log(`sweep: ${r.n} scenes, ${r.bad.length + errs.length} errors`);
  // 2. narration follows the beat
  const g = await p.evaluate(() => { setNarrate(1); const i = scenes.findIndex((x) => x.dataset.id === 'hooks'); go(i, 2); const now = document.querySelector('#guideBody p.now'); return now ? now.textContent.slice(0, 16) : null; });
  if (!g || !g.startsWith('UserPromptSubmit')) fails.push(`narration: hooks beat 2 highlighted ${JSON.stringify(g)}`);
  console.log(`narration: ${g}`); await p.close(); }

// 3. reduced motion: one complete still frame per scene
{ const { p } = await page(deck + '#scene=1&beat=0', { reducedMotion: 'reduce' });
  await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const empty = await p.evaluate(() => { const out = []; for (let i = 0; i < N; i++) { go(i, 0); paint(0); const c = scenes[i].querySelector('.cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let j = 3; j < d.length; j += 256) if (d[j]) n++; if (!n) out.push(scenes[i].dataset.id) } return { motion: MOTION, out }; });
  if (empty.motion || empty.out.length) fails.push(`reduced motion: MOTION=${empty.motion}, empty frames ${empty.out.join(',')}`);
  console.log(`reduced motion: ${empty.out.length} empty frames`); await p.close(); }

// 4. capture purity: sequential frames with screenshots vs a fresh load at the same t
for (const [scene, k] of [[2, 19], [14, 12], [20, 18]]) {
  const fps = 6, url = `${deck}?t=0#scene=${scene}`;
  const at = (p, t) => p.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; } window.renderAt(t); }, t);
  const A = (await page(url)).p; await A.waitForFunction(() => window.__ready === true);
  for (let i = 0; i <= k; i++) { await at(A, i / fps); await A.screenshot(); }
  const a = await A.screenshot(); await A.close();
  const B = (await page(url)).p; await B.waitForFunction(() => window.__ready === true); await at(B, k / fps); const b = await B.screenshot(); await B.close();
  const same = a.equals(b); if (!same) fails.push(`purity: scene ${scene} frame ${k} differs between paint orders`);
  console.log(`purity scene ${scene} frame ${k}: ${same ? 'identical' : 'DIFFERS'}`);
}

// 5. still frames stay still: capture at a fixed t, and reduced motion, after waiting (P20 r1: ambient drift)
{ const p = (await page(`${deck}?t=0#scene=3`)).p; await p.waitForFunction(() => window.__ready === true);
  await p.evaluate(() => window.renderAt(2)); const a = await p.screenshot(); await p.waitForTimeout(1200); const b = await p.screenshot(); await p.close();
  if (!a.equals(b)) fails.push('capture: frame t=2 changed while frozen'); console.log(`capture frozen 1.2 s: ${a.equals(b) ? 'still' : 'MOVED'}`); }
{ const p = (await page(deck + '#scene=3', { reducedMotion: 'reduce' })).p; await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  await p.waitForTimeout(3500); /* after the HUD's idle fade (a state change, not motion) */ const a = await p.screenshot(); await p.waitForTimeout(1200); const b = await p.screenshot(); await p.close();
  if (!a.equals(b)) fails.push('reduced motion: page kept moving'); console.log(`reduced motion 1.2 s: ${a.equals(b) ? 'still' : 'MOVED'}`); }
// 6. malformed deep links fall back to a scene instead of crashing (P20 r1)
for (const h of ['#scene=not-a-number&beat=nope', '#scene=999&beat=-4', '#scene=&beat=']) {
  const { p, errs } = await page(deck + h); await p.waitForTimeout(500);
  const c = await p.evaluate(() => (typeof cur === 'number' ? cur : -2)); await p.close();
  if (errs.length || c < 0) fails.push(`deep link ${h}: cur=${c} ${errs.join(';')}`); console.log(`deep link ${h}: scene ${c + 1}`); }
// 7. an open presenter follows theme and tone (P20 r1)
{ const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const A = await ctx2.newPage(), B = await ctx2.newPage(); await A.goto(deck + '#scene=4'); await B.goto(deck.replace('index.html', 'index.html?presenter') + '#scene=4');
  await A.waitForFunction(() => cur >= 0); await B.waitForFunction(() => typeof cur === 'number');
  await A.keyboard.press('t'); await A.keyboard.press('o'); await B.waitForTimeout(400);
  const look = await B.evaluate(() => [root.dataset.theme || 'dark', root.dataset.tone || 'midnight']); await ctx2.close();
  if (look[0] !== 'day' || look[1] !== 'graphite') fails.push(`presenter look: ${look}`); console.log(`presenter follows look: ${look.join(', ')}`); }
// 8. WebGL context loss falls back to the 2D orb and keeps drawing (P20 r2)
{ const { p, errs } = await page(deck + '#scene=1'); await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const r = await p.evaluate(async () => { go(0, 0); paint(0); /* warm the lazy sprite renderer, or lose() has no context to lose */ if (!ORB.ok) return { ok: true, lit: 0, cold: 1 }; ORB.lose(); await new Promise((z) => setTimeout(z, 150)); for (let n = 0; n < 5; n++) { T0 += 1 / 60; paint(1 / 60); }
    const c = scenes[0].querySelector('.cv'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let j = 3; j < d.length; j += 400) if (d[j]) lit++; return { ok: ORB.ok, lit }; });
  await p.close(); if (r.ok || r.lit < 500 || errs.length) fails.push(`context loss: ${JSON.stringify(r)} ${errs.join(';')}`); console.log(`context loss: fallback=${!r.ok}, lit=${r.lit}`); }
// 9. frame budget: CPU paint stays well inside 60 Hz in the densest orb scenes (P20 r2: 11.9 ms median before batching)
{ const p = (await page(deck + '#scene=1')).p; await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const r = await p.evaluate(() => { const out = {}; for (const id of ['brk6', 'roles', 'title']) { const i = scenes.findIndex((x) => x.dataset.id === id); go(i, 0); for (let n = 0; n < 20; n++) { T0 += 1 / 60; paint(1 / 60); }
    const ts = []; for (let n = 0; n < 120; n++) { T0 += 1 / 60; const a = performance.now(); paint(1 / 60); ts.push(performance.now() - a); } ts.sort((a, b) => a - b); out[id] = ts[114]; } return out; });
  const calls = await p.evaluate(() => { const i = scenes.findIndex((x) => x.dataset.id === 'brk6'); go(i, 0); paint(0); ORB.stats.batch = 0; ORB.stats.sprite = 0; paint(1 / 60); return { ...ORB.stats }; });
  await p.close(); if (calls.batch !== 1 || calls.sprite !== 0) fails.push(`orb batching: ${JSON.stringify(calls)} per paint, expected one batched draw`);
  console.log(`orb draws per paint (brk6, 9 orbs): ${JSON.stringify(calls)}`);
  for (const [id, p95] of Object.entries(r)) if (p95 > 16) fails.push(`frame budget: ${id} p95 ${p95.toFixed(1)} ms`); console.log(`paint p95 ms: ${Object.entries(r).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`); }
// 10. Enter on a focused ledger row opens that scene (P20 r2)
{ const p = (await page(deck + '#scene=20')).p; await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  await p.keyboard.press('l'); await p.waitForTimeout(200); await p.focus('#ledgerList button[data-k="5"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
  const c = await p.evaluate(() => cur); await p.close(); if (c !== 5) fails.push(`ledger Enter: scene ${c + 1}, expected 6`); console.log(`ledger Enter: scene ${c + 1}`); }
// 11. scene change keeps the outgoing scene's orbs through the cross-fade (P20 r3)
{ const p = (await page(deck + '#scene=1')).p; await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const r = await p.evaluate(() => { const i = scenes.findIndex((x) => x.dataset.id === 'brk6'), j = scenes.findIndex((x) => x.dataset.id === 'roles'); go(i, 0); for (let n = 0; n < 30; n++) { T0 += 1 / 60; paint(1 / 60); }
    const cv = scenes[i].querySelector('.cv'), lit = () => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = 0; for (let k = 0; k < d.length; k += 16) s += d[k + 3]; return s; };
    const before = lit(); go(j, 0); T0 += 1 / 60; paint(1 / 60); return { before, after: lit(), parent: document.querySelector('.orbl').parentElement.dataset.id }; });
  await p.close(); if (!(r.after > r.before * 1.02)) fails.push(`transition: outgoing scene lost its orbs ${JSON.stringify(r)}`); console.log(`transition hand-off: ${JSON.stringify(r)}`); }
// 12. capture is pure for scenes that build DOM in init: going back in t matches a fresh load (Stratum B r3)
for (const scene of [6, 37]) {
  const at = (p, t) => p.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t * 1000; } window.renderAt(t); }, t);
  const count = (p) => p.evaluate(() => [document.querySelectorAll('#stack .plate').length, document.querySelectorAll('#prims .prim').length]);
  const A = (await page(`${deck}?t=0#scene=${scene}`)).p; await A.waitForFunction(() => window.__ready === true); await at(A, 1); await at(A, .5); const ca = await count(A); const sa = await A.screenshot(); await A.close();
  const B = (await page(`${deck}?t=0#scene=${scene}`)).p; await B.waitForFunction(() => window.__ready === true); await at(B, .5); const cb = await count(B); const sb = await B.screenshot(); await B.close();
  const ok = JSON.stringify(ca) === JSON.stringify(cb) && (ca[0] === 6 || ca[1] === 20) && sa.equals(sb);
  if (!ok) fails.push(`capture DOM purity scene ${scene}: counts ${JSON.stringify(ca)} vs ${JSON.stringify(cb)}, images ${sa.equals(sb) ? 'same' : 'differ'}`);
  console.log(`capture DOM purity scene ${scene}: [plates, prims] ${JSON.stringify(ca)}, ${sa.equals(sb) ? 'identical' : 'DIFFERS'}`); }
// 13. guide mode keeps the HUD on screen and unoverlapped at laptop widths (Stratum B r3)
for (const w of [1280, 1440, 1920]) {
  const p = (await page(deck + '#scene=12&guide', { viewport: { width: w, height: Math.round(w * 9 / 16) } })).p; await p.waitForFunction(() => typeof go === 'function' && cur >= 0 && narr === 1); await p.waitForTimeout(700);
  const r = await p.evaluate(() => { document.body.classList.add('awake'); const R = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
    return { vw: innerWidth, vh: innerHeight, brand: R('.brand'), ctrls: R('.ctrls'), dock: R('.dock'), guide: R('#guidePanel') }; });
  await p.close(); const ov = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3], inside = (a) => a[0] >= 0 && a[1] >= 0 && a[2] <= r.vw && a[3] <= r.vh;
  const bad = []; for (const k of ['brand', 'ctrls', 'dock']) { if (!inside(r[k])) bad.push(`${k} off-screen`); if (ov(r[k], r.guide)) bad.push(`${k} under guide`); }
  if (ov(r.brand, r.ctrls)) bad.push('brand overlaps controls');
  if (bad.length) fails.push(`guide HUD at ${w}: ${bad.join(', ')}`); console.log(`guide HUD at ${w}: ${bad.length ? bad.join(', ') : 'ok'}`); }
// 14. a deep link pasted into an open deck navigates (visual pass: hash edits were ignored after boot)
{ const p = (await page(deck + '#scene=3')).p; await p.waitForFunction(() => typeof go === 'function' && cur === 2);
  await p.evaluate(() => { location.hash = 'scene=12&beat=2&guide' }); await p.waitForTimeout(300); const a = await p.evaluate(() => [cur, step, narr]);
  await p.evaluate(() => { location.hash = '20.0' }); await p.waitForTimeout(300); const c = await p.evaluate(() => cur); await p.close();
  const ok = a[0] === 11 && a[1] === 2 && a[2] === 1 && c === 19; if (!ok) fails.push(`hash navigation: got ${JSON.stringify(a)} then ${c}`);
  console.log(`hash navigation: ${ok ? 'ok' : 'FAILED'} ${JSON.stringify(a)} -> ${c}`); }

// 15. reduced motion shows where a late beat ends up, not its first instant (P20 r1 on #1186: timers never advanced at dt=0)
{ const p = (await page(deck + '#scene=16', { reducedMotion: 'reduce' })).p; await p.waitForFunction(() => typeof go === 'function' && cur === 15);
  const got = {};
  for (const [n, k, probe] of [[16, 3, 'SC.frontmatter.ed.filter(e => e.v > .96).length'], [25, 2, 'SC.map.w.length'], [29, 4, 'SC.spawn.dots.filter(d => d.sp.v > .9).length']]) {
    await p.evaluate(([n, k]) => go(n - 1, k), [n, k]); await p.waitForTimeout(500); got[n] = await p.evaluate(probe); }
  await p.close(); const ok = got[16] === 23 && got[25] > 0 && got[29] === 838;
  if (!ok) fails.push(`reduced motion late beats: ${JSON.stringify(got)}`); console.log(`reduced motion late beats: ${ok ? 'ok' : 'FAILED'} ${JSON.stringify(got)}`); }
// 16. media fallbacks win over agenda and pill material declarations (m2).
{ const { p } = await page(deck + '#scene=3');
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  const blur = await p.evaluate(() => getComputedStyle(document.querySelector('.agenda .glass')).backdropFilter);
  if (blur !== 'none') fails.push(`agenda reduced transparency: ${blur}`);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
  const rings = await p.evaluate(() => [...document.querySelectorAll('.seg,.pill')].map(e => getComputedStyle(e).boxShadow));
  if (!rings.length || rings.some(s => !s.includes('1.5px'))) fails.push(`high contrast rings: ${JSON.stringify(rings)}`);
  console.log(`media fallbacks: agenda=${blur}, ${rings.length} contrast rings`); await p.close(); }
// 17. breakers skip the reduced-motion simulation; stateful scenes retain settling (m1/m3).
{ const { p } = await page(deck + '#scene=4', { reducedMotion: 'reduce' });
  await p.waitForFunction(() => typeof go === 'function' && cur >= 0);
  const r = await p.evaluate(() => {
    const i = scenes.findIndex(s => s.classList.contains('brk')); go(i, 0);
    const o = S(i), draw = o.draw; let calls = 0;
    o.draw = function(...args) { calls++; return draw.apply(this,args) }; settled='';
    const start=performance.now(); paint(0); const ms=performance.now()-start; o.draw=draw;
    go(scenes.findIndex(s => s.dataset.id==='gov'),0); paint(0);
    for(let j=0;j<80;j++)domFrame(.033);
    const chip=SC.gov.ch[3]; return { calls, ms, filter:chip.style.filter }; });
  if (r.calls!==1 || Number(r.filter.match(/opacity\(([\d.]+)\)/)?.[1]) !== .5) fails.push(`reduced-motion fixes: ${JSON.stringify(r)}`);
  console.log(`reduced-motion breaker/chip: ${JSON.stringify(r)}`); await p.close(); }
await browser.close();
for (const f of fails) console.log('FAIL', f);
process.exit(fails.length ? 1 : 0);
