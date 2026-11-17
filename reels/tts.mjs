// Generates the spoken lines of the reel series (BRO-3817) with the keynote's River voice, and the timeline
// the renderer and the shared overlay read.
// Usage: bun reels/tts.mjs [--reel <id> | --all] [--dry-run | --offline]
//   For each part: reels/audio/<reel>-hook.mp3 (series.json `spokenHook`), reels/audio/cta.mp3 (`funnel.spokenCta`,
//   identical in every part, generated once), each with .alignment.json and .receipt.json, then
//   reels/audio/<reel>.series.json and reels/audio/<reel>.series.js (window.SERIES, loaded by the page).
//   A line whose receipt matches the request (voice id + payload) and whose audio matches the receipt is reused,
//   so a rerun costs nothing. --dry-run prints what would be generated and touches nothing.
// API exactly as the keynote generator (river-eleven-v4/generate-river.py): POST /v1/text-to-speech/<voice>/with-timestamps.
// The key is ELEVENLABS_API_KEY parsed from $ELEVENLABS_ENV_FILE (default: the workspace .env.local under the
// home directory). It is only read when a line has to be generated, and it is never printed or written.
//
// v2 mode (Act I v2, BRO-3825): bun reels/tts.mjs --v2 --reel <v2 reel> [--dry-run | --offline]
//   Reads series.json `v2`. Generates the shared CTA once (reels/audio/v2/v2-cta.*, reused by every part), then the
//   part's hook and body as one take (reels/audio/v2/<reel>.*), each with alignment and receipt, then the part's
//   timeline reels/audio/v2/<reel>.timeline.json/.js (window.REEL_V2): take → excerpt hold → CTA → end hold, the line
//   and word timings from the River alignment, and CWI-shaped caption events. Before every request the cost is
//   estimated from the characters (v2.budget.creditsPerCharacter); a line over its cap (ctaCapCredits /
//   partCapCredits) stops before anything is spent. v2 MP3s are media and are not committed: each one is copied to
//   the content-flow media store (~/.local/share/content-flow/media/sha256/<audioSha256>.mp3, or $CF_MEDIA_DIR) and
//   restored from there when a checkout lacks it; the receipt's audioSha256 still has to match.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url)), AUDIO = path.join(here, 'audio');
const VOICE_ID = 'SAz9YHcvj6GT2YYXdXww', MODEL_ID = 'eleven_v4', GAP = 0.25, TOTAL = 5;
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] };
const DRY = argv.includes('--dry-run'), OFFLINE = argv.includes('--offline');   // --offline: never call the API (render.mjs uses it)
const series = JSON.parse(readFileSync(path.join(here, 'series.json'), 'utf8'));
const want = arg('--reel'), V2 = argv.includes('--v2');
if (!want && (V2 || !argv.includes('--all'))) { console.error('usage: bun reels/tts.mjs [--reel <id> | --all] [--dry-run | --offline]\n       bun reels/tts.mjs --v2 --reel <v2 reel> [--dry-run | --offline]'); process.exit(2) }
const parts = V2 ? [] : series.parts.filter(p => !want || p.reel === want);
if (!V2 && !parts.length) { console.error(`no part with reel "${want}" in series.json`); process.exit(2) }
if (!DRY) mkdirSync(AUDIO, { recursive: true });
const MEDIA = process.env.CF_MEDIA_DIR || path.join(homedir(), '.local', 'share', 'content-flow', 'media', 'sha256');

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
const billed = [];
// budget: { rate, cap } (v2 only). The estimate is made before the request; over the cap, nothing is sent.
async function line(stem, text, meta, budget = null) {
  const mp3 = path.join(AUDIO, `${stem}.mp3`), rec = path.join(AUDIO, `${stem}.receipt.json`), ali = path.join(AUDIO, `${stem}.alignment.json`);
  const payload = { text, model_id: MODEL_ID, language_code: 'en' };
  const requestSha256 = sha(pyJson({ voice_id: VOICE_ID, payload }));
  if (budget && !existsSync(mp3) && existsSync(rec)) {     // v2 media lives in the content-flow store, not in git
    const want = JSON.parse(readFileSync(rec, 'utf8')).audioSha256, stored = want && path.join(MEDIA, `${want}.mp3`);
    if (stored && existsSync(stored) && !DRY) { copyFileSync(stored, mp3); console.log(`restored ${stem}.mp3 from the media store`) }
  }
  if (existsSync(mp3) && existsSync(rec) && existsSync(ali)) {
    const r = JSON.parse(readFileSync(rec, 'utf8'));
    if (r.requestSha256 === requestSha256) {
      // reuse only what the receipt vouches for: the audio bytes, the alignment bytes, and an alignment that spells the line
      if (r.audioSha256 !== sha(readFileSync(mp3))) throw new Error(`${stem}.mp3 does not match its receipt; refusing to reuse it`);
      if (!r.alignmentSha256) throw new Error(`${stem}.receipt.json records no alignmentSha256; refusing to reuse ${stem}.alignment.json`);
      if (r.alignmentSha256 !== sha(readFileSync(ali))) throw new Error(`${stem}.alignment.json does not match its receipt; refusing to reuse it`);
      alignmentChars(ali, text);
      console.log(`reused   ${stem} (${text.length} chars, receipt matches)`);
      return { mp3, ali };
    }
    console.log(`changed  ${stem}: the request differs from its receipt, regenerating`);
  }
  const estimate = budget ? Math.ceil(text.length * budget.rate) : null;
  if (budget && estimate > budget.cap) throw new Error(`Stopped before spending on ${stem}: ${text.length} characters × ${budget.rate} ≈ ${estimate} credits, over its cap of ${budget.cap}. Nothing was sent.`);
  if (DRY) { console.log(`would generate ${stem}: ${text.length} characters${budget ? ` ≈ ${estimate} credits (cap ${budget.cap})` : ''}`); return null }
  if (OFFLINE) throw new Error(`${stem} needs new audio (its text changed in series.json); run bun reels/tts.mjs --reel <id> first`);
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': apiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Stopped on ${stem}: ElevenLabs HTTP ${res.status}. Earlier lines are preserved; no automatic retries.`);
  const result = await res.json(), audio = Buffer.from(result.audio_base64, 'base64');
  delete result.audio_base64;
  if (audio.length < 1000) throw new Error(`${stem}: ElevenLabs returned ${audio.length} bytes of audio`);
  writeFileSync(mp3, audio);
  const aliText = `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(ali, aliText);
  const response = Object.fromEntries(['request-id', 'character-cost'].filter(h => res.headers.get(h)).map(h => [h, res.headers.get(h)]));
  writeFileSync(rec, `${JSON.stringify({
    ...meta, voice_id: VOICE_ID, model_id: MODEL_ID, endpoint: 'with-timestamps', outputFormat: 'mp3_44100_128',
    requestSha256, audioSha256: sha(audio), alignmentSha256: sha(aliText), characters: text.length,
    ...(budget ? { estimateCredits: estimate, capCredits: budget.cap, creditsPerCharacter: budget.rate } : {}),
    generatedAt: new Date().toISOString(), response,
  }, null, 2)}\n`);
  charactersUsed += text.length;
  billed.push({ stem, characters: text.length, estimate, billed: response['character-cost'] ?? null });
  if (budget) { mkdirSync(MEDIA, { recursive: true }); copyFileSync(mp3, path.join(MEDIA, `${sha(audio)}.mp3`)) }
  console.log(`generated ${stem}: ${text.length} characters${response['character-cost'] ? ` (billed ${response['character-cost']})` : ''}`);
  if (budget && +response['character-cost'] > budget.cap) console.error(`WARNING ${stem}: billed ${response['character-cost']} credits, over its cap of ${budget.cap} (estimate was ${estimate})`);
  return { mp3, ali };
}

// The character alignment must spell the line exactly; the timeline's words come from it, so a mismatch is an error.
function alignmentChars(aliFile, text) {
  const data = JSON.parse(readFileSync(aliFile, 'utf8')), a = data.alignment || data.normalized_alignment;
  if (!a || a.characters?.join('') !== text) throw new Error(`${path.basename(aliFile)} does not spell "${text}"; refusing to build a timeline from it`);
  return a;
}
// Word timings from the character alignment: a word starts at its first character and ends at its last.
function words(aliFile, text, dur) {
  const a = alignmentChars(aliFile, text);
  const ch = a.characters, s = a.character_start_times_seconds, e = a.character_end_times_seconds;
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
if (V2) { await v2(); process.exit(0) }
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
  if (DRY) { console.log(`${p.reel}: timeline would be rewritten (dry run writes nothing)`); continue }
  writeFileSync(path.join(AUDIO, `${p.reel}.series.json`), `${json}\n`);
  writeFileSync(path.join(AUDIO, `${p.reel}.series.js`),
    `// GENERATED by reels/tts.mjs from series.json and the River line timings. Do not edit.\nwindow.SERIES=${json};\n`);
  console.log(`${p.reel}: hook ${hookDur}s + gap ${GAP}s + body ${bodyDur}s + cta ${ctaDur}s + hold ${hold}s = ${S.total_dur}s`);
}
console.log(`ElevenLabs characters used this run: ${charactersUsed}`);

// ── v2 (Act I v2, BRO-3825) ─────────────────────────────────────────────────────────────────────────────────────
// One take per part (hook + body, as the reviewed script card speaks them), the shared CTA, and the timeline:
//   0 ── take ── take.dur ── excerpt hold ── cta.at ── CTA ── end.at ── end hold ── total_dur
// (function declarations, not consts: v2() runs from the middle of the file, before a const here would exist)
function bare(w) { return w.toLowerCase().replace(/[^\p{L}\p{N}-]/gu, '') }
// CWI-shaped caption events from River word timings: one per spoken line. A line longer than MAX_EVENT_CHARS is split
// where the halves are most even, preferring a break after punctuation and never ending on a function word (no
// orphaned last word), recursively until every event fits.
function events(lines, emph, keyword) {
  const MAX_EVENT_CHARS = 42;                               // FCC caption length, as in the v1 CWI renderer
  const FUNC = /^(a|an|the|of|to|in|on|and|or|but|for|with|by|its|it|is|be|can|that)$/i;
  const len = ws => ws.map(w => w.text).join(' ').length;
  const split = ws => {
    if (ws.length < 2 || len(ws) <= MAX_EVENT_CHARS) return [ws];
    let best = 1, cost = Infinity;
    for (let c = 1; c < ws.length; c++) {
      const a = ws.slice(0, c), b = ws.slice(c);
      const k = Math.abs(len(a) - len(b)) - (/[.,;:?!]$/.test(a.at(-1).text) ? 12 : 0) + (FUNC.test(a.at(-1).text) ? 100 : 0)
        + (len(a) > MAX_EVENT_CHARS || len(b) > MAX_EVENT_CHARS ? 50 : 0);
      if (k < cost) { cost = k; best = c }
    }
    return [...split(ws.slice(0, best)), ...split(ws.slice(best))];
  };
  const out = lines.flatMap(split);
  return out.map((ws, i) => ({
    id: `e${String(i + 1).padStart(2, '0')}`, speaker_id: 'S0', start: ws[0].start, end: ws.at(-1).end,
    words: ws.map(w => {
      const em = emph.has(bare(w.text)) || (!!keyword && w.text.includes(keyword));
      return { text: w.text, start: w.start, end: w.end, weight: em ? 700 : 400, size: em ? 1.08 : 1, emphasis: em };
    }),
  }));
}
function shift(ws, at) { return ws.map(w => ({ ...w, start: +(w.start + at).toFixed(3), end: +(w.end + at).toFixed(3) })) }

async function v2() {
  const V = series.v2, P = V.parts.find(p => p.reel === want);
  if (!P?.spoken) { console.error(`no v2 part with reel "${want}" and spoken lines in series.json v2.parts`); process.exit(2) }
  const D = path.join(AUDIO, 'v2'); if (!DRY) mkdirSync(D, { recursive: true });
  const rate = V.budget.creditsPerCharacter, takeText = P.spoken.join(' ');
  // pre-flight: both lines are checked against their caps before either request, so a run never spends half
  for (const [what, text, cap] of [['the shared CTA', V.cta.spoken, V.budget.ctaCapCredits], [P.reel, takeText, V.budget.partCapCredits]])
    if (Math.ceil(text.length * rate) > cap)
      throw new Error(`Stopped before spending: ${what} is ${text.length} characters × ${rate} ≈ ${Math.ceil(text.length * rate)} credits, over its cap of ${cap}. Nothing was sent.`);
  const cta = await line(`v2/${V.cta.asset}`, V.cta.spoken, { line: 'cta', field: 'v2.cta.spoken', shared: 'every v2 part' },
    { rate, cap: V.budget.ctaCapCredits });
  const take = await line(`v2/${P.reel}`, takeText, { line: 'take', field: 'v2.parts[].spoken', part: P.part, reel: P.reel, script: P.scriptSha256 },
    { rate, cap: V.budget.partCapCredits });
  if (!cta || !take) { console.log(`${P.reel}: timeline would be rebuilt (dry run writes nothing)`); return summary() }
  const takeDur = duration(take.mp3), ctaDur = duration(cta.mp3);
  const tw = words(take.ali, takeText, takeDur), cw = words(cta.ali, V.cta.spoken, ctaDur);
  let k = 0;
  const lineWords = P.spoken.map(text => { const n = text.split(/\s+/).length, ws = tw.slice(k, k + n); k += n; return ws });
  if (k !== tw.length || lineWords.some((ws, i) => ws.map(w => w.text).join(' ') !== P.spoken[i]))
    throw new Error(`${P.reel}: the take's words do not split back into its ${P.spoken.length} spoken lines`);
  const exWords = P.excerpt.text.split(/\s+/).length;
  const hold = Math.ceil(Math.max(V.excerptHold.minSeconds, exWords / V.excerptHold.wordsPerSecond) * 10) / 10;
  const ctaAt = +(takeDur + hold).toFixed(3), endAt = +(ctaAt + ctaDur).toFixed(3), total = +(endAt + V.endHoldSeconds).toFixed(3);
  const ctaWords = shift(cw, ctaAt), emph = new Set((P.emphasis || []).map(bare));
  const S = {
    version: 2, part: P.part, total: 5, reel: P.reel, title: P.title, series: series.series, act: series.act,
    script: P.scriptSha256, headline: P.headline, disclosure: series.voice.disclosure,
    take: { text: takeText, at: 0, dur: takeDur, audio: `v2/${P.reel}.mp3`, words: tw,
      lines: lineWords.map((ws, i) => ({ text: P.spoken[i], start: ws[0].start, end: ws.at(-1).end })) },
    excerpt: { text: P.excerpt.text, source: P.excerpt.source, at: takeDur, hold },
    cta: { text: V.cta.spoken, keyword: V.cta.keyword, at: ctaAt, dur: ctaDur, audio: `v2/${V.cta.asset}.mp3`, words: ctaWords },
    end: { at: ctaAt, card: [V.cta.endCard, P.next], hold: V.endHoldSeconds },
    captions: {
      version: '1.0', metadata: { duration: total, language: 'en', generator: 'reels/tts.mjs --v2 (River character alignment)' },
      cast: [{ id: 'S0', name: 'River', color: '#6B8AFF' }],
      captions: [...events(lineWords, emph), ...events([ctaWords], new Set(), V.cta.keyword)],
    },
    total_dur: total,
  };
  const json = JSON.stringify(S, null, 2);
  writeFileSync(path.join(D, `${P.reel}.timeline.json`), `${json}\n`);
  writeFileSync(path.join(D, `${P.reel}.timeline.js`),
    `// GENERATED by reels/tts.mjs --v2 from series.json v2 and the River alignments. Do not edit.\nwindow.REEL_V2=${json};\n`);
  console.log(`${P.reel}: take ${takeDur}s + excerpt ${hold}s + cta ${ctaDur}s + hold ${V.endHoldSeconds}s = ${total}s`);
  summary();
}
function summary() {
  for (const b of billed) console.log(`billed   ${b.stem}: ${b.characters} characters, estimate ${b.estimate}, character-cost ${b.billed}`);
  console.log(`ElevenLabs characters used this run: ${charactersUsed}`);
}
