// Requires a running Next app. No model calls, no external data: real sandbox iframe + ELK + backend bridge.
// BLOCKS_URL=http://localhost:3000 node dev/blocks-app-e2e.mjs
import assert from 'node:assert/strict';
import { launch } from './chromium.mjs';
const origin=process.env.BLOCKS_URL||'http://127.0.0.1:3000';
const browser=await launch();
try {
  const page=await browser.newPage(), errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/blocks/playground.html',{waitUntil:'networkidle0'});
  await page.waitForFunction(()=>document.querySelector('#log').textContent.includes('New instance'));
  let frame=page.frames().find(f=>f.url()==='about:srcdoc');
  await frame.waitForSelector('.flow-node',{timeout:30000});
  assert.equal(await frame.$$eval('.flow-node',nodes=>nodes.length),4);
  assert.equal(await frame.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(31, 30, 28)');
  assert.equal(await frame.$eval('.flow-status',e=>e.textContent),'');
  await page.select('#example','Independent counters');
  await page.waitForFunction(()=>document.querySelector('#log').textContent.includes('New instance'));
  frame=page.frames().find(f=>f.url()==='about:srcdoc');
  await frame.waitForSelector('x-block button');
  await frame.click('x-block button');
  await frame.waitForFunction(()=>document.querySelector('x-block button').textContent.includes('1'));
  await page.click('[data-size="300,1000"]');
  await page.click('#theme');
  await frame.waitForFunction(()=>document.querySelector('x-split').dataset.stacked==='true');
  assert.equal(await frame.$eval('x-block button',e=>e.textContent),'First: 1');
  assert.equal(await frame.$eval('body',e=>e.dataset.theme),'light');
  const before=await frame.$eval('x-block button',e=>e.textContent);
  // A different window must not replace the runtime's source or theme.
  await frame.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'theme',vars:{'--fg':'red'},theme:'spoofed'}})));
  assert.equal(await frame.$eval('body',e=>e.dataset.theme),'light');
  assert.equal(await frame.$eval('x-block button',e=>e.textContent),before);
  await page.select('#example','Backend stream (opt-in)');
  frame=page.frames().find(f=>f.url()==='about:srcdoc');
  await frame.waitForSelector('button');
  await frame.click('button');
  await frame.waitForFunction(()=>document.querySelector('p').textContent.includes('disabled'));
  await page.click('#backend');
  await frame.click('button');
  await frame.waitForFunction(()=>document.querySelector('p').textContent==='Done',{timeout:60000});
  assert.match((await frame.$eval('pre',e=>e.textContent)).trim(),/(?:^|\n)0\n1\n2$/);
  const response=await fetch(origin+'/api/blocks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backend:'bash',command:"printf 'héllo 🙂\\n'"})});
  assert.equal(response.status,200);
  const records=(await response.text()).trim().split('\n').map(s=>JSON.parse(s));
  assert.ok(records.some(r=>r.t==='chunk' && r.chunk.includes('héllo 🙂')));
  assert.equal(records.at(-1).ok,true);
  const marker=`.blocks-cancel-${Date.now()}`;
  const controller=new AbortController();
  const running=await fetch(origin+'/api/blocks',{method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({backend:'bash',command:`printf 'started\\n'; (sleep 1; printf orphaned > ${marker}) & wait`})});
  const reader=running.body.getReader();
  let output='';
  while(!output.includes('started')) {const {value,done}=await reader.read();if(done)throw new Error('Process ended before cancellation');output+=new TextDecoder().decode(value);}
  controller.abort(); await reader.cancel().catch(()=>{});
  await new Promise(r=>setTimeout(r,1600));
  const checked=await fetch(origin+'/api/blocks',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backend:'bash',command:`test ! -e ${marker}; status=$?; rm -f ${marker}; exit $status`})});
  const checkEvents=(await checked.text()).trim().split('\n').map(s=>JSON.parse(s));
  assert.equal(checkEvents.at(-1).ok,true,'Cancellation must kill shell descendants');
  const invalid=await fetch(origin+'/api/blocks',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});
  assert.equal(invalid.status,400);
  assert.deepEqual(errors,[]);
  console.log('App sandbox, real worker, scoped state across resize/theme, message rejection, backend opt-in, real Python/Bash and invalid request checks passed');
  if(process.env.SHOT)await page.screenshot({path:process.env.SHOT,fullPage:true});
} finally {await browser.close();}
