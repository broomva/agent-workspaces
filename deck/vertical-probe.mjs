import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(process.env.PLAYWRIGHT_DIR ? path.join(process.env.PLAYWRIGHT_DIR, 'noop.js') : import.meta.url);
const { chromium } = req('playwright');

const deck = pathToFileURL(path.join(here, 'index.html')).href;
const b = await chromium.launch({ args: ['--disable-gpu-vsync'] });
const p0 = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p0.goto(deck + '?t=0#scene=1');
await p0.waitForFunction(() => window.__ready === true);
const data = await p0.evaluate(() => JSON.parse(document.querySelector('#narration-data').textContent));

const manifest = {};
manifest["default"] = { "mode": "full" };

// Inject a helper for image processing in the page
await p0.addInitScript(() => {
  window.__probeCanvas = document.createElement('canvas');
  window.__probeCanvas.width = 1920;
  window.__probeCanvas.height = 1080;
  window.__probeCtx = window.__probeCanvas.getContext('2d', { willReadFrequently: true });
  window.__frames = [];
  
  window.__addFrame = async (b64) => {
    const img = new Image();
    img.src = 'data:image/jpeg;base64,' + b64;
    await new Promise(r => img.onload = r);
    window.__probeCtx.drawImage(img, 0, 0);
    window.__frames.push(window.__probeCtx.getImageData(0, 0, 1920, 1080).data);
  };
  
  window.__getVisualBbox = (textRightEdge) => {
    if (window.__frames.length === 0) return null;
    const w = 1920, h = 1080;
    const n = window.__frames.length;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    
    // Background is Midnight fill (e.g. #050B1A ~ 5, 11, 26).
    for (let y = 0; y < h; y++) {
      for (let x = Math.max(0, textRightEdge - 40); x < w; x++) {
        const i = (y * w + x) * 4;
        let minR = 255, minG = 255, minB = 255;
        let maxR = 0, maxG = 0, maxB = 0;
        for (let f = 0; f < n; f++) {
           const r = window.__frames[f][i];
           const g = window.__frames[f][i+1];
           const b = window.__frames[f][i+2];
           if (r < minR) minR = r; if (g < minG) minG = g; if (b < minB) minB = b;
           if (r > maxR) maxR = r; if (g > maxG) maxG = g; if (b > maxB) maxB = b;
        }
        
        const diff = Math.max(maxR - minR, maxG - minG, maxB - minB);
        if (diff > 10 || (maxR > 15 || maxG > 20 || maxB > 35)) {
           if (x < minX) minX = x;
           if (y < minY) minY = y;
           if (x > maxX) maxX = x;
           if (y > maxY) maxY = y;
        }
      }
    }
    
    window.__frames = [];
    if (maxX < minX) return null;
    return [Math.max(0, minX - 24), Math.max(0, minY - 24), Math.min(w, maxX + 24), Math.min(h, maxY + 24)];
  };
});

const chapters = data.chapters.map((c, i) => ({
  ...c,
  startSeconds: c.startSeconds || 0,
  endSeconds: i + 1 < data.chapters.length ? data.chapters[i+1].startSeconds : data.duration
}));

for (const c of chapters) {
  const isFull = ['title', 'agenda', 'brk1', 'brk2', 'brk3', 'brk4', 'brk5', 'brk6', 'brk7'].includes(c.id);
  if (isFull) {
    manifest[c.id] = { mode: 'full' };
    continue;
  }
  
  await p0.goto('about:blank');
  await p0.goto(`${deck}?t=0#scene=${c.scene}`);
  await p0.waitForFunction(() => window.__ready === true);
  
  let lastBeat = 0;
  if (c.cues && c.cues.length) lastBeat = c.cues[c.cues.length - 1].beat;

  await p0.evaluate(({cues}) => {
    window.__cues = cues; simReset(captureScene());
    window.__adv = function(t) {
      const i = simScene, n = Math.max(0, Math.round(t * 60));
      while (window.simN < n) {
        const lt = window.simN / 60; let bt = 0;
        for (const q of window.__cues) if (q.at <= lt + 1e-4) bt = q.beat;
        if (bt !== step) go(i, bt, true);
        window.T0 += 1 / 60; window.NOW += 1 / 60; domFrame(1 / 60); paint(1 / 60); window.simN++;
      }
      bgDraw(window.T0); rebuild();
    }
  }, {cues: c.cues});

  const duration = c.endSeconds - c.startSeconds;
  const numFrames = 8;
  for (let i = 0; i < numFrames; i++) {
    const t = (i / (numFrames - 1)) * duration;
    
    await p0.evaluate((t) => window.__adv(t), t);
    
    await p0.evaluate(() => new Promise(r => requestAnimationFrame(r)));
    const buf = await p0.screenshot({ type: 'jpeg', quality: 90 });
    await p0.evaluate(async (b64) => await window.__addFrame(b64), buf.toString('base64'));
  }

  // Get text box at LAST beat by advancing to the end of the scene
  await p0.evaluate((t) => window.__adv(t), duration);
  
  await p0.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  
  const textInfo = await p0.evaluate((id) => {
    const scene = document.querySelector(`.scene[data-id="${id}"]`);
    if (!scene) return null;
    const els = scene.querySelectorAll('.kick, h1, h2, h3, .lede, .glass, .card');
    let minX = 1920, minY = 1080, maxX = 0, maxY = 0;
    let found = false;
    for (const el of els) {
      if (el.closest('.stack') || el.closest('#stack') || el.closest('.ambient') || el.closest('.orbl') || el.closest('.code') || el.closest('.ycard') || el.closest('.seg')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.x < minX) minX = rect.x;
      if (rect.y < minY) minY = rect.y;
      if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
      if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
      found = true;
    }
    if (!found) return null;
    return [Math.max(0, minX - 24), Math.max(0, minY - 24), Math.min(1920, maxX + 24), Math.min(1080, maxY + 24)];
  }, c.id);

  if (!textInfo) {
    manifest[c.id] = { mode: 'full' };
    continue;
  }
  
  const textRightEdge = textInfo[2];
  const visBbox = await p0.evaluate((rightEdge) => window.__getVisualBbox(rightEdge), textRightEdge);
  
  if (visBbox) {
     manifest[c.id] = {
       visual: [Math.round(visBbox[0]), Math.round(visBbox[1]), Math.round(visBbox[2] - visBbox[0]), Math.round(visBbox[3] - visBbox[1])],
       text: [Math.round(textInfo[0]), Math.round(textInfo[1]), Math.round(textInfo[2] - textInfo[0]), Math.round(textInfo[3] - textInfo[1])]
     };
  } else {
     manifest[c.id] = {
       visual: [Math.round(textInfo[2]), 0, Math.round(1920 - textInfo[2]), 1080],
       text: [Math.round(textInfo[0]), Math.round(textInfo[1]), Math.round(textInfo[2] - textInfo[0]), Math.round(textInfo[3] - textInfo[1])]
     };
  }
  console.log(`Probe ${c.id}: `, manifest[c.id]);
}

writeFileSync(path.join(here, 'vertical.json'), JSON.stringify(manifest, null, 2));
await b.close();
console.log('Done probe');
