// Exercise the real bundled MP3 and media events, not a parallel simulated clock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
const url=pathToFileURL(new URL('index.html',import.meta.url).pathname).href;
const html=readFileSync(new URL('index.html',import.meta.url),'utf8');
const data=JSON.parse(html.match(/<script id="narration-data" type="application\/json">(.*?)<\/script>/s)[1]);
const scenes=[...html.matchAll(/<section class="scene(?: brk)?" data-id="(\w+)" data-act="\d" data-steps="(\d+)"/g)];
assert.equal(data.chapters.length,scenes.length);
assert.equal(createHash('sha256').update(readFileSync(new URL('narration/river.mp3',import.meta.url))).digest('hex'),data.audioSha256);
for(let i=0;i<scenes.length;i++){
 const ch=data.chapters[i];assert.equal(ch.id,scenes[i][1]);assert.deepEqual(ch.cues.map(c=>c.beat).sort((a,b)=>a-b),Array.from({length:+scenes[i][2]},(_,n)=>n));
 assert(Math.abs(ch.startSeconds-(i?data.chapters[i-1].startSeconds+data.chapters[i-1].durationSeconds:0))<.001);
 for(let j=0;j<ch.cues.length;j++){const c=ch.cues[j];assert(c.at>=0&&c.at<ch.durationSeconds);if(j)assert(c.at>=ch.cues[j-1].at);if(c.spokenAt!==undefined)assert(Math.abs(c.at-Math.max(.001,c.spokenAt-data.cueLeadSeconds))<.001)}
}
const browser=await chromium.launch();
try{
 const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(url+'?play');await p.waitForFunction(()=>playback?.active);
 assert(await p.$eval('audio',a=>a.paused),'deep link must not autoplay');
 await p.click('#playback-toggle');await p.waitForFunction(()=>document.querySelector('audio').currentTime>.2);
 await p.click('#playback-toggle');assert(await p.$eval('audio',a=>a.paused));
 assert(Math.abs(await p.$eval('audio',a=>a.duration)-data.duration)<.1);
 // Real seeks on either side of every cue and chapter boundary, including backward-order beats.
 const sweep=await p.evaluate(async()=>{
  const a=document.querySelector('audio'),d=JSON.parse(document.querySelector('#narration-data').textContent),bad=[];
  async function seek(t){if(Math.abs(a.currentTime-t)<.00001)return;a.currentTime=t;await new Promise(resolve=>a.addEventListener('seeked',resolve,{once:true}))}
  for(let i=0;i<d.chapters.length;i++){const ch=d.chapters[i];for(const cue of ch.cues){for(const delta of [-.02,.02]){
   const t=Math.max(0,ch.startSeconds+cue.at+delta);await seek(t);const ci=d.chapters.findLastIndex(c=>c.startSeconds<=t),c=d.chapters[ci];let expected=0;for(const q of c.cues)if(q.at<=t-c.startSeconds+.0001)expected=q.beat;
   if(cur!==ci||step!==expected)bad.push({t,cur,step,ci,expected});
  }}}
  return bad;
 });assert.deepEqual(sweep,[]);console.log('playback: all 103 cue boundaries + chapter crossings follow real audio seeks');
 // Manual navigation, keyboard range behavior, speed, captions, pause stability.
 await p.evaluate(()=>go(15,3));await p.waitForFunction(()=>cur===15&&step===3&&!document.querySelector('audio').seeking);
 assert(Math.abs(await p.$eval('audio',a=>a.currentTime)-(data.chapters[15].startSeconds+data.chapters[15].cues.find(c=>c.beat===3).at))<.01);
 await p.focus('#playback-seek');await p.keyboard.press('Home');await p.waitForFunction(()=>cur===0&&step===0);
 await p.keyboard.press('Space');await p.waitForFunction(()=>!document.querySelector('audio').paused);await p.keyboard.press('Space');assert(await p.$eval('audio',a=>a.paused),'Space must pause with slider focus after seeking');
 await p.click('#playback-settings');await p.selectOption('#playback-rate','1.5');assert.equal(await p.$eval('audio',a=>a.playbackRate),1.5);
 await p.click('#playback-cc');assert(await p.$eval('#playback-caption',e=>e.hidden));await p.click('#playback-cc');
 await p.evaluate(()=>{document.activeElement.blur();go(1,0)});await p.waitForFunction(()=>!document.querySelector('audio').seeking);
 await p.keyboard.press('Space');await p.waitForFunction(()=>!document.querySelector('audio').paused);
 // Advance through an actual reveal using the player's selected rate.
 await p.evaluate(()=>{document.querySelector('audio').currentTime=JSON.parse(document.querySelector('#narration-data').textContent).chapters[1].startSeconds+5.4});
 await p.waitForFunction(()=>cur===1&&step===1);await p.keyboard.press('Space');
 const paused=await p.evaluate(()=>({cur,step,time:document.querySelector('audio').currentTime}));await p.waitForTimeout(300);
 const still=await p.evaluate(()=>({cur,step,time:document.querySelector('audio').currentTime}));assert.deepEqual(still,paused);
 await p.keyboard.press('Escape');assert(await p.$eval('audio',a=>a.paused));assert(await p.$eval('#playback',e=>e.hidden));
 await p.evaluate(()=>go(4,1));assert.equal(await p.evaluate(()=>step),1);assert.equal(await p.evaluate(()=>playback.active),false);
 console.log('playback: native play/pause, speed, captions, manual jumps, slider keyboard, exit and pause stability passed');
 // Finish and replay; opening while paused does not generate audio automatically.
 await p.evaluate(()=>{playback.open();const input=document.querySelector('#playback-seek');input.value=String(document.querySelector('audio').duration-.15);input.dispatchEvent(new Event('input'))});
 await p.waitForFunction(()=>!document.querySelector('audio').seeking);await p.click('#playback-toggle');await p.waitForFunction(()=>document.querySelector('audio').ended);
 assert.equal(await p.evaluate(()=>cur),36);assert.match(await p.$eval('#playback-status',e=>e.textContent),/complete/);
 await p.keyboard.press('ArrowLeft');await p.waitForFunction(()=>!document.querySelector('audio').seeking);assert(!await p.$eval('#playback-toggle',e=>e.textContent.includes('Replay')));assert.equal(await p.$eval('#playback-status',e=>e.textContent),'');
 await p.evaluate(()=>{const input=document.querySelector('#playback-seek');input.value=String(document.querySelector('audio').duration-.15);input.dispatchEvent(new Event('input'))});await p.waitForFunction(()=>!document.querySelector('audio').seeking);await p.click('#playback-toggle');await p.waitForFunction(()=>document.querySelector('audio').ended);
 await p.click('#playback-toggle');await p.waitForFunction(()=>cur===0&&!document.querySelector('audio').paused);await p.keyboard.press('Escape');
 for(const query of ['?t=0','?presenter','?mirror']){await p.goto(url+query);assert.equal(await p.evaluate(()=>playback),null);assert.equal(await p.$eval('audio',a=>a.getAttribute('src')),null)}
 console.log('playback: completion/replay and capture/presenter/mirror audio isolation passed');
 // Responsive bounds and reduced motion preserve all functional controls.
 await p.setViewportSize({width:390,height:844});await p.emulateMedia({reducedMotion:'reduce'});await p.goto(url+'?play');
 assert.equal(await p.evaluate(()=>MOTION),false);
 const layout=await p.evaluate(()=>{const r=document.querySelector('#playback').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}});
 assert(layout.left>=0&&layout.right<=layout.width&&!layout.overflow,JSON.stringify(layout));
 await p.click('#playback-toggle');await p.waitForFunction(()=>document.querySelector('audio').currentTime>.1);await p.keyboard.press('Escape');
 // HTTP range delivery is the deployed host contract; exercise a cold mid-deck start.
 const source=new URL('.',import.meta.url);let ranges=true;
 const server=createServer((req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://local').pathname).replace(/^\//,'');const bytes=readFileSync(new URL(name||'index.html',source));const headers={'Cache-Control':'no-store','Content-Type':name.endsWith('.mp3')?'audio/mpeg':name.endsWith('.html')?'text/html':'application/octet-stream'};
  const range=ranges&&req.headers.range?.match(/bytes=(\d+)-(\d*)/);let body=bytes;
  if(range){const start=+range[1],end=range[2]?Math.min(+range[2],bytes.length-1):bytes.length-1;body=bytes.subarray(start,end+1);headers['Content-Range']=`bytes ${start}-${end}/${bytes.length}`}
  if(ranges)headers['Accept-Ranges']='bytes';headers['Content-Length']=body.length;res.writeHead(range?206:200,headers);
  if(name.endsWith('.mp3')){res.write(body.subarray(0,65536));setTimeout(()=>res.end(body.subarray(65536)),250)}else res.end(body)
 }catch{res.writeHead(404);res.end()}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}/index.html?play`;
  await p.goto(base+'#scene=16&beat=1');assert.equal(await p.evaluate(()=>cur),15);await p.click('#playback-toggle');
  await p.waitForFunction(()=>document.querySelector('audio').currentTime>564&&!document.querySelector('audio').muted);assert.equal(await p.evaluate(()=>cur),15);await p.keyboard.press('Escape');
  ranges=false;await p.goto(base+'&no-range#scene=16&beat=1');await p.click('#playback-toggle');
  await p.waitForFunction(()=>document.querySelector('audio').paused&&document.querySelector('#playback-status').textContent.includes('cannot seek'));
  assert.equal(await p.evaluate(()=>cur),15);await p.click('#playback-restart');await p.waitForFunction(()=>cur===0&&!document.querySelector('audio').muted&&document.querySelector('audio').currentTime>.1);await p.keyboard.press('Escape');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
 console.log('playback: cold HTTP deep link starts at its cue; unsupported seeking pauses safely and Restart recovers');
 assert.deepEqual(errors,[]);console.log('playback: mobile bounds and reduced-motion audio passed; no page errors');
}finally{await browser.close()}
