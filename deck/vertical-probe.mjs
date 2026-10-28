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
manifest["default"] = { "visual": [960, 0, 960, 1080], "text": [0, 0, 960, 1080] };

for (const c of data.chapters) {
  await p0.goto('about:blank');
  await p0.goto(`${deck}?t=0#scene=${c.scene}`);
  await p0.waitForFunction(() => window.__ready === true);
  
  await p0.evaluate(async (cues) => {
    window.__cues = cues; simReset(captureScene());
    let lastBeat = 0;
    if (cues && cues.length) {
      lastBeat = cues[cues.length - 1].beat;
    }
    go(simScene, lastBeat, true);
    domFrame(1); paint(1);
    await new Promise(r => setTimeout(r, 100)); 
  }, c.cues);

  const res = await p0.evaluate(() => {
    const scene = document.querySelector('.scene:not([style*="visibility: hidden"])');
    if (!scene) return null;
    if (scene.classList.contains('brk') || scene.dataset.id === 'title' || scene.dataset.id === 'agenda' || scene.dataset.id === 'medallion') {
      return { mode: 'full' };
    }
    const els = scene.querySelectorAll('.kick, h1, h2, h3, .lede, .glass, .card, pre, ul, p');
    let minX = 1920, minY = 1080, maxX = 0, maxY = 0;
    let found = false;
    for (const el of els) {
      if (el.closest('.ambient') || el.closest('.orbl')) continue;
      if (window.getComputedStyle(el).opacity === '0' || window.getComputedStyle(el).display === 'none') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      
      // Sometimes .scene bounds is captured if 'p' is full width, exclude full width paragraphs
      if (rect.width > 1800) continue;

      if (rect.x < minX) minX = rect.x;
      if (rect.y < minY) minY = rect.y;
      if (rect.x + rect.width > maxX) maxX = rect.x + rect.width;
      if (rect.y + rect.height > maxY) maxY = rect.y + rect.height;
      found = true;
    }
    if (!found) return { mode: 'full' };
    
    minX = Math.max(0, minX - 24);
    minY = Math.max(0, minY - 24);
    maxX = Math.min(1920, maxX + 24);
    maxY = Math.min(1080, maxY + 24);
    
    const text = [Math.round(minX), Math.round(minY), Math.round(maxX - minX), Math.round(maxY - minY)];
    let vx = Math.round(maxX);
    let vw = 1920 - vx;
    let vh = 1080;
    let vy = 0;
    
    if (vw < 200) return { mode: 'full' };
    
    return {
      visual: [vx, vy, vw, vh],
      text: text
    };
  });
  
  if (res) manifest[c.id] = res;
}

writeFileSync(path.join(here, 'vertical.json'), JSON.stringify(manifest, null, 2));
await b.close();
console.log('Done probe');
