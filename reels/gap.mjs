// Pure parts of `tts.mjs --v2`'s planned inter-line gaps: where to cut, how to insert the silence, and how to shift the
// alignment. No ffmpeg, no files, no network, so scripts/reels-guards.mjs tests them on synthetic PCM in CI.

export const SR = 44100;
export const WIN = Math.round(0.01 * SR);     // the quietest 10 ms is where a cut goes
export const STEP = 44;                       // search stride, in samples
export const FADE = Math.round(0.004 * SR);   // 4 ms fade either side of the inserted silence
// Root-mean-square ceiling (16-bit scale) for a cut window. The committed takes measure 0.7-6.3 at their cuts and about
// 2000 in speech, so a boundary whose quietest 10 ms is above this has no silence to cut in, and the cut is refused.
export const MAX_CUT_RMS = 100;

// The cut for one line boundary: the middle of the quietest WIN samples inside [lo, hi). Refuses a window shorter
// than WIN, or one whose quietest WIN samples are not silence, instead of cutting into speech.
export function quietestCut(pcm, lo, hi, label) {
  lo = Math.max(0, Math.min(lo, pcm.length));
  hi = Math.max(0, Math.min(hi, pcm.length));
  if (hi - lo < WIN)
    throw new Error(`${label}: the silence between the lines is ${(((hi - lo) / SR) * 1000).toFixed(1)} ms, under the ${WIN / SR * 1000} ms a cut needs`);
  let best = -1, min = Infinity;
  for (let x = lo; x + WIN <= hi; x += STEP) {
    let en = 0;
    for (let k = x; k < x + WIN; k++) en += pcm[k] * pcm[k];
    if (en < min) { min = en; best = x + (WIN >> 1) }
  }
  const rms = Math.sqrt(min / WIN);
  if (rms > MAX_CUT_RMS)
    throw new Error(`${label}: the quietest 10 ms between the lines has RMS ${rms.toFixed(1)}, over ${MAX_CUT_RMS}; there is no silence to cut in`);
  return { sample: best, rms };
}

// Inserts `ins` zero samples at each cut (ascending source samples), with a FADE-sample fade either side.
export function insertGaps(pcm, cuts, ins) {
  const out = new Int16Array(pcm.length + ins * cuts.length);
  let from = 0, to = 0;
  const holes = [];
  for (const c of cuts) {
    out.set(pcm.subarray(from, c), to); to += c - from;
    holes.push(to); to += ins; from = c;                        // out[to, to + ins) stays zero
  }
  out.set(pcm.subarray(from), to);
  for (const h of holes) for (let k = 0; k < FADE; k++) {
    if (h - 1 - k >= 0) out[h - 1 - k] = Math.round(out[h - 1 - k] * k / FADE);                     // fade out into the gap
    if (h + ins + k < out.length) out[h + ins + k] = Math.round(out[h + ins + k] * k / FADE);       // fade in after it
  }
  return out;
}

// Every character of line n moves by (n - 1) gaps; the boundary space keeps its start and ends after the gap.
// `firsts` is the first character index of each line in the joined text.
export function shiftAlignment(starts, ends, firsts, gap) {
  const line = c => firsts.filter(f => f <= c).length - 1;
  const r4 = v => +v.toFixed(4);
  return {
    starts: starts.map((v, c) => r4(v + gap * line(c))),
    ends: ends.map((v, c) => r4(v + gap * (line(c) + (firsts.includes(c + 1) ? 1 : 0)))),
  };
}
