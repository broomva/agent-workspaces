// Generates the spoken lines of the reel series (BRO-3817) with the keynote's River voice, and the timeline
// the renderer and the shared overlay read.
// Usage: bun reels/tts.mjs [--reel <id> | --all] [--dry-run]
//   For each part: reels/audio/<reel>-hook.mp3 (series.json `spokenHook`), reels/audio/cta.mp3 (`funnel.spokenCta`,
//   identical in every part, generated once), each with .alignment.json and .receipt.json, then
//   reels/audio/<reel>.series.json and reels/audio/<reel>.series.js (window.SERIES, loaded by the page).
//   A line whose receipt matches the request (voice id + payload) and whose audio matches the receipt is reused,
//   so a rerun costs nothing. --dry-run prints what would be generated and touches nothing.
// API exactly as the keynote generator (river-eleven-v4/generate-river.py): POST /v1/text-to-speech/<voice>/with-timestamps.
// The key is ELEVENLABS_API_KEY parsed from $ELEVENLABS_ENV_FILE (default: the workspace .env.local under the
// home directory). It is only read when a line has to be generated, and it is never printed or written.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), AUDIO = path.join(here, 'audio');
const VOICE_ID = 'SAz9YHcvj6GT2YYXdXww', MODEL_ID = 'eleven_v4', GAP = 0.25, TOTAL = 5;
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] };
const DRY = argv.includes('--dry-run');
const series = JSON.parse(readFileSync(path.join(here, 'series.json'), 'utf8'));
const want = arg('--reel');
if (!want && !argv.includes('--all')) { console.error('usage: bun reels/tts.mjs [--reel <id> | --all] [--dry-run]'); process.exit(2) }
const parts = series.parts.filter(p => !want || p.reel === want);
if (!parts.length) { console.error(`no part with reel "${want}" in series.json`); process.exit(2) }
mkdirSync(AUDIO, { recursive: true });

const sha = b => createHash('sha256').update(b).digest('hex');
// Python json.dumps(..., sort_keys=True) (default separators, ensure_ascii), so a receipt digest here equals the
// digest the keynote generator computes for the same request.
const pyJson = v => Array.isArray(v) ? `[${v.map(pyJson).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${pyJson(k)}: ${pyJson(v[k])}`).join(', ')}}`
    : typeof v === 'string' ? JSON.stringify(v).replace(/[^\x00-\x7f]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      : JSON.stringify(v);
const duration = f => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f], { encoding: 'utf8' });
  if (r.status) throw new Error(`ffprobe failed on ${path.basename(f)}: ${r.stderr}`);
  return +(+r.stdout.trim()).toFixed(3);
};

let key = null;
function apiKey() {
  if (key) return key;
  const file = process.env.ELEVENLABS_ENV_FILE || path.join(homedir(), 'broomva', '.env.local');
  const m = readFileSync(file, 'utf8').match(/^\s*(?:export\s+)?ELEVENLABS_API_KEY\s*=\s*(.*?)\s*$/m);
  if (!m) throw new Error('ELEVENLABS_API_KEY not found in $ELEVENLABS_ENV_FILE');
  key = m[1].trim().replace(/^["']|["']$/g, '');
  return key;
}

let charactersUsed = 0;
async function line(stem, text, meta) {
  const mp3 = path.join(AUDIO, `${stem}.mp3`), rec = path.join(AUDIO, `${stem}.receipt.json`), ali = path.join(AUDIO, `${stem}.alignment.json`);
  const payload = { text, model_id: MODEL_ID, language_code: 'en' };
  const requestSha256 = sha(pyJson({ voice_id: VOICE_ID, payload }));
  if (existsSync(mp3) && existsSync(rec) && existsSync(ali)) {
    const r = JSON.parse(readFileSync(rec, 'utf8'));
    if (r.requestSha256 === requestSha256) {
      if (r.audioSha256 !== sha(readFileSync(mp3))) throw new Error(`${stem}.mp3 does not match its receipt; refusing to reuse it`);
      console.log(`reused   ${stem} (${text.length} chars, receipt matches)`);
      return { mp3, ali };
    }
    console.log(`changed  ${stem}: the request differs from its receipt, regenerating`);
  }
  if (DRY) { console.log(`would generate ${stem}: ${text.length} characters`); return null }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Stopped on ${stem}: ElevenLabs HTTP ${res.status}. Earlier lines are preserved; no automatic retries.`);
  const result = await res.json(), audio = Buffer.from(result.audio_base64, 'base64');
  delete result.audio_base64;
  if (audio.length < 1000) throw new Error(`${stem}: ElevenLabs returned ${audio.length} bytes of audio`);
  writeFileSync(mp3, audio);
  writeFileSync(ali, `${JSON.stringify(result, null, 2)}\n`);
  const response = Object.fromEntries(['request-id', 'character-cost'].filter(h => res.headers.get(h)).map(h => [h, res.headers.get(h)]));
  writeFileSync(rec, `${JSON.stringify({
    ...meta, voice_id: VOICE_ID, model_id: MODEL_ID, endpoint: 'with-timestamps', outputFormat: 'mp3_44100_128',
    requestSha256, audioSha256: sha(audio), characters: text.length, generatedAt: new Date().toISOString(), response,
  }, null, 2)}\n`);
  charactersUsed += text.length;
  console.log(`generated ${stem}: ${text.length} characters${response['character-cost'] ? ` (billed ${response['character-cost']})` : ''}`);
  return { mp3, ali };
}

// Word timings from the character alignment: a word starts at its first character and ends at its last.
function words(aliFile, text, dur) {
  const data = JSON.parse(readFileSync(aliFile, 'utf8')), a = data.alignment || data.normalized_alignment;
  const ch = a.characters, s = a.character_start_times_seconds, e = a.character_end_times_seconds;
  if (ch.join('') !== text) console.warn(`alignment text differs from the line in ${path.basename(aliFile)}; using the alignment`);
  const out = []; let cur = null;
  ch.forEach((c, i) => {
    if (/\s/.test(c)) { if (cur) out.push(cur); cur = null; return }
    if (!cur) cur = { text: '', start: s[i], end: e[i] };
    cur.text += c; cur.end = e[i];
  });
  if (cur) out.push(cur);
  // the alignment can run past the end of the decoded clip (cta.mp3: 3.36 s vs 3.28 s); a word never ends after its clip
  return out.map(w => ({ text: w.text, start: +Math.min(w.start, dur).toFixed(3), end: +Math.min(w.end, dur).toFixed(3) }));
}

const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);
const cta = await line('cta', series.funnel.spokenCta, { line: 'cta', field: 'funnel.spokenCta' });
for (const p of parts) {
  const hook = await line(`${p.reel}-hook`, p.spokenHook, { line: 'hook', field: 'spokenHook', part: p.part, reel: p.reel });
  if (!hook || !cta) continue;
  const hookDur = duration(hook.mp3), ctaDur = duration(cta.mp3), bodyDur = +(p.body.end - p.body.start).toFixed(3);
  const bodyAt = +(hookDur + GAP).toFixed(3), ctaAt = +(bodyAt + bodyDur).toFixed(3), hold = series.endCard.holdSeconds;
  const vars = { ...p, cardCta: series.funnel.cardCta, keyword: series.funnel.keyword };
  const S = {
    part: p.part, total: TOTAL, reel: p.reel, title: p.title, series: series.series, act: series.act,
    hook: { text: p.spokenHook, at: 0, dur: hookDur, words: words(hook.ali, p.spokenHook, hookDur), audio: `${p.reel}-hook.mp3` },
    gap: GAP, screenHook: p.screenHook,
    body: { start: p.body.start, end: p.body.end, dur: bodyDur, at: bodyAt },
    cta: { text: series.funnel.spokenCta, at: ctaAt, dur: ctaDur, words: words(cta.ali, series.funnel.spokenCta, ctaDur), audio: 'cta.mp3' },
    hold, next: p.next, cardCta: series.funnel.cardCta, keyword: series.funnel.keyword,
    card: series.endCard.lines.map(l => fill(l, vars)),
    total_dur: +(ctaAt + ctaDur + hold).toFixed(3),
  };
  const json = JSON.stringify(S, null, 2);
  writeFileSync(path.join(AUDIO, `${p.reel}.series.json`), `${json}\n`);
  writeFileSync(path.join(AUDIO, `${p.reel}.series.js`),
    `// GENERATED by reels/tts.mjs from series.json and the River line timings. Do not edit.\nwindow.SERIES=${json};\n`);
  console.log(`${p.reel}: hook ${hookDur}s + gap ${GAP}s + body ${bodyDur}s + cta ${ctaDur}s + hold ${hold}s = ${S.total_dur}s`);
}
console.log(`ElevenLabs characters used this run: ${charactersUsed}`);
