// Shared overlay of the Agent Workspaces reel series (BRO-3817). Load it after the reel's own script, with
// audio/<reel>.series.js (window.SERIES, written by reels/tts.mjs) before it. Without window.SERIES it does nothing.
//
//   0 ── body.at ─────────────── cta.at ─────── total_dur
//   cold open │ the reel's own renderAt(t - body.at), │ end card
//   (hook)    │ its CWI captions                      │ (CTA + hold)
//
// Every frame stays a pure function of t. The reel keeps its visuals and captions; this file only maps time, hides the
// body caption outside the body, and draws the two series panels in the deck's look, inside the IG safe zone
// (x 143-938, y 277-1643; nothing right of x 872 below y 922). The reel's "AI voice" label stays on top.
(() => {
  const S = window.SERIES;
  if (!S || window.SERIES_OVERLAY) return;
  if (typeof window.renderAt !== 'function') { console.error('series-overlay.js: load it after the script that defines window.renderAt'); return }

  const css = `
#sx{position:absolute;inset:0;z-index:40;pointer-events:none;color:oklch(0.975 0.004 250);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
.kick{z-index:45}
.sx-scrim{position:absolute;inset:0;background:radial-gradient(110% 70% at 50% 38%,oklch(0.2 0.032 248 / .8),oklch(0.135 0.028 250 / .93));
  -webkit-backdrop-filter:blur(18px) saturate(140%);backdrop-filter:blur(18px) saturate(140%)}
/* each phase is centred in the band between the safe-zone top and the caption band (y 300-1270) */
.sx-phase{position:absolute;left:143px;top:300px;height:970px;width:795px;display:flex;flex-direction:column;justify-content:center;align-items:flex-start}
.sx-tag{display:flex;align-items:center;gap:16px;font:500 22px/1 'JetBrains Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:oklch(0.71 0.15 252)}
.sx-tag::before{content:"";width:40px;height:1.5px;background:currentColor;opacity:.7}
.sx-tag span{color:oklch(0.65 0.022 248)}
.sx-hook{margin-top:56px;width:780px;font:300 100px/1.05 'Raleway',sans-serif;letter-spacing:-.034em;text-wrap:balance;
  text-shadow:0 2px 30px oklch(0.155 0.028 250 / .6)}
.sx-hook .w{display:inline-block;white-space:pre}
.sx-hook .w.em{font-weight:400;color:oklch(0.71 0.15 252)}
.sx-chips{margin-top:72px;display:flex;flex-wrap:wrap;gap:22px;max-width:729px}
.sx-glass{position:relative;isolation:isolate;border-radius:24px;
  background:linear-gradient(180deg,oklch(0.36 0.03 248 / .34),oklch(0.2 0.03 250 / .3) 55%,oklch(0.17 0.03 250 / .4));
  box-shadow:0 30px 80px -30px oklch(0.04 0.02 250 / .85),0 8px 22px -12px oklch(0.04 0.02 250 / .6),inset 0 1px 0 oklch(1 0 0 / .2),
    inset 0 14px 28px -18px oklch(1 0 0 / .1),inset 0 -22px 34px -26px oklch(0.8 0.12 222 / .22),inset 0 0 0 1px oklch(1 0 0 / .045)}
.sx-glass::after{content:"";position:absolute;inset:0;border-radius:inherit;padding:1.4px;pointer-events:none;opacity:.75;
  background:conic-gradient(from var(--ua,0deg),
  oklch(0.4 0.012 250 / .5) 0deg,oklch(0.62 0.014 245 / .6) 48deg,oklch(0.97 0.01 240 / .92) 70deg,oklch(0.82 0.12 215 / .8) 77deg,oklch(0.62 0.014 245 / .55) 98deg,
  oklch(0.32 0.01 250 / .4) 168deg,oklch(0.56 0.014 245 / .55) 228deg,oklch(0.92 0.01 240 / .82) 250deg,oklch(0.86 0.1 85 / .55) 256deg,oklch(0.5 0.014 245 / .5) 278deg,oklch(0.4 0.012 250 / .5) 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.sx-chip{padding:20px 28px;border-radius:999px;font:400 34px/1.1 'Inter',sans-serif;color:oklch(0.975 0.004 250)}
.sx-ctr{display:flex;align-items:baseline;gap:18px;padding:22px 30px}
.sx-ctr small{font:500 19px/1 'JetBrains Mono',monospace;letter-spacing:.18em;color:oklch(0.65 0.022 248)}
.sx-ctr b{font:500 52px/1 'JetBrains Mono',monospace;letter-spacing:.04em}
.sx-ctr.zero b{color:oklch(0.67 0.21 28)}
.sx-next{margin-top:44px;width:729px;padding:30px 36px 34px}
.sx-next small{display:block;font:500 20px/1 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:oklch(0.71 0.15 252)}
.sx-next p{margin-top:18px;font:300 56px/1.1 'Raleway',sans-serif;letter-spacing:-.025em;text-wrap:balance}
.sx-cta{margin-top:28px;width:729px;padding:30px 36px 36px;text-align:center}
.sx-cta .pre,.sx-cta .post{font:400 38px/1.2 'Inter',sans-serif;color:oklch(0.83 0.015 248)}
.sx-cta .post{color:oklch(0.975 0.004 250)}
.sx-cta mark{display:inline-block;margin:16px 0 18px;padding:14px 30px 16px;border-radius:20px;background:oklch(0.86 0.12 88 / .14);
  box-shadow:inset 0 0 0 1.5px oklch(0.86 0.12 88 / .6);font:500 84px/1 'JetBrains Mono',monospace;letter-spacing:.06em;color:oklch(0.86 0.12 88)}
.sx-say{position:absolute;left:540px;bottom:460px;transform:translateX(-50%);max-width:640px;width:max-content;padding:12px 28px 14px;border-radius:30px;
  text-align:center;font:500 46px/1.14 'Roboto Flex','Inter',sans-serif;letter-spacing:-.01em;text-wrap:balance;color:oklch(0.83 0.015 248)}
.sx-say .w{display:inline-block;white-space:pre}
`;
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const wordsHtml = (ws, cls = () => '') => ws.map((w, i) => `<span class="w${cls(w, i)}">${esc(w.text)}</span>`).join(' ');
  const chip = s => {
    const m = /^(.*?)\s+(\d{2,})$/.exec(s);                // "SESSIONS 020" reads as a counter, like the reel's own
    return m ? `<div class="sx-glass sx-chip sx-ctr${/^0+$/.test(m[2]) ? ' zero' : ''}"><small>${esc(m[1])}</small><b>${esc(m[2])}</b></div>`
      : `<div class="sx-glass sx-chip">${esc(s)}</div>`;
  };
  const [tag, nextLine, ctaLine] = S.card;
  const tagHtml = l => { const [a, ...b] = l.split(' · '); return `<div class="sx-tag"><b>${esc(a)}</b>${b.length ? `<span>${esc(b.join(' · '))}</span>` : ''}</div>` };
  const nx = nextLine.split('→'), ct = ctaLine.split(S.keyword);
  const lastHook = S.hook.words.length - 1;

  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div'); root.id = 'sx';
  root.innerHTML = `<div class="sx-scrim"></div>
<section class="sx-phase" id="sx-open">${tagHtml(`Part ${S.part}/${S.total} · ${S.series}`)}
  <p class="sx-hook">${wordsHtml(S.hook.words, (w, i) => i === lastHook ? ' em' : '')}</p>
  <div class="sx-chips">${S.screenHook.map(chip).join('')}</div></section>
<section class="sx-phase" id="sx-end">${tagHtml(tag)}
  <div class="sx-glass sx-next"><small>${esc(nx.length > 1 ? `${nx[0].trim()} →` : 'Next →')}</small><p>${esc((nx[1] ?? nx[0]).trim())}</p></div>
  <div class="sx-glass sx-cta"><div class="pre">${esc(ct[0].trim())}</div><mark>${esc(S.keyword)}</mark><div class="post">${esc((ct[1] || '').trim())}</div></div></section>
<div class="sx-glass sx-say" id="sx-say">${wordsHtml(S.cta.words, w => w.text.includes(S.keyword) ? ' kw' : '')}</div>`;
  document.body.appendChild(root);

  const $ = id => document.getElementById(id), scrim = root.firstElementChild, open = $('sx-open'), end = $('sx-end'), say = $('sx-say');
  const hookW = [...open.querySelectorAll('.sx-hook .w')], sayW = [...say.children], chips = [...open.querySelectorAll('.sx-chip')];
  const mark = end.querySelector('mark'), next = end.querySelector('.sx-next'), ctaBox = end.querySelector('.sx-cta');
  const cap = document.getElementById('cap') || document.querySelector('.cap');
  const clampN = (x, a, b) => Math.min(b, Math.max(a, x));
  const ease = x => { x = clampN(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 };
  const ramp = (t, a, d) => ease((t - a) / d);
  const kwAt = S.cta.words.find(w => w.text.includes(S.keyword))?.start ?? 0;
  // a settled element carries no transform, filter or opacity (see settle() in the reels: a leftover blur(0) composites differently)
  const set = (el, k, tf) => { el.style.opacity = k >= 1 ? '' : String(k); el.style.transform = k >= 1 ? '' : tf(k) };

  function reveal(spans, words, tl, dim, lit, em) {      // a word lifts and brightens as it is spoken
    words.forEach((w, i) => {
      const el = spans[i], p = ease((tl - w.start + .04) / .22);
      el.style.opacity = p >= 1 ? '' : (dim + (1 - dim) * p).toFixed(3);
      el.style.transform = p >= 1 || p <= 0 ? '' : `translateY(${((1 - p) * 8).toFixed(2)}px)`;
      if (lit) el.style.color = p >= 1 ? lit(w) : p <= 0 ? '' : `color-mix(in oklab, ${lit(w)} ${(p * 100).toFixed(1)}%, oklch(0.83 0.015 248))`;
      if (em) el.style.textShadow = em(w) && tl >= w.start ? '0 0 22px oklch(0.86 0.12 88 / .55)' : '';
    });
  }

  const inner = window.renderAt;
  window.renderAt = function (t) {
    inner(clampN(t - S.body.at, 0, S.body.dur));
    if (cap) cap.style.visibility = t >= S.body.at && t < S.cta.at ? '' : 'hidden';
    root.style.setProperty('--ua', ((t * 40) % 360).toFixed(1) + 'deg');
    // cold open: full from frame 0 (H1), out across the gap into the body
    const kOpen = 1 - ramp(t, S.body.at - .3, .35), kEnd = ramp(t, S.cta.at - .12, .4);
    scrim.style.opacity = String(Math.max(kOpen, kEnd));
    open.style.visibility = kOpen > 0 ? '' : 'hidden'; open.style.opacity = kOpen >= 1 ? '' : String(kOpen);
    if (kOpen > 0) {
      reveal(hookW, S.hook.words, t, .36, null, null);
      const zero = t >= S.hook.words[lastHook].start;       // the zero counters flare as the last word lands
      chips.forEach(c => { c.style.boxShadow = zero && c.classList.contains('zero') ? `0 0 0 2px oklch(0.67 0.21 28 / ${(.9 * (1 - ramp(t, S.hook.words[lastHook].start + .5, .8))).toFixed(3)}), 0 0 48px oklch(0.67 0.21 28 / .35)` : '' });
    }
    // end card: in at the CTA, fully settled before the hold
    end.style.visibility = say.style.visibility = kEnd > 0 ? '' : 'hidden';
    if (kEnd > 0) {
      const tc = t - S.cta.at;
      set(end.querySelector('.sx-tag'), kEnd, k => `translateY(${(1 - k) * -12}px)`);
      set(next, ramp(t, S.cta.at - .05, .4), k => `translateY(${(1 - k) * 22}px)`);
      set(ctaBox, ramp(t, S.cta.at + .05, .4), k => `translateY(${(1 - k) * 22}px) scale(${.96 + .04 * k})`);
      const bump = Math.sin(Math.PI * clampN((tc - kwAt) / .5, 0, 1));
      mark.style.transform = bump > 0 ? `scale(${(1 + .06 * bump).toFixed(4)})` : '';
      mark.style.boxShadow = tc >= kwAt ? `inset 0 0 0 1.5px oklch(0.86 0.12 88 / .8), 0 0 ${(28 + 30 * bump).toFixed(1)}px oklch(0.86 0.12 88 / .35)` : '';
      say.style.opacity = kEnd >= 1 ? '' : String(kEnd);
      reveal(sayW, S.cta.words, tc, .38, w => w.text.includes(S.keyword) ? 'oklch(0.86 0.12 88)' : 'oklch(0.8 0.12 245)', w => w.text.includes(S.keyword));
    }
  };

  const fonts = ['300 100px Raleway', '300 56px Raleway', '400 100px Raleway', '400 38px Inter', '500 22px "JetBrains Mono"', '500 84px "JetBrains Mono"', '500 46px "Roboto Flex"'];
  window.SERIES_OVERLAY = { ready: Promise.all(fonts.map(f => document.fonts.load(f).catch(() => null))).then(() => document.fonts.ready).then(() => true) };
})();
