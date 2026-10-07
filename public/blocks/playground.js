/* Production runtime in an opaque-origin iframe. The lab never substitutes fake elements. */
(() => {
  const $ = (id) => document.getElementById(id);
  const samples = {
    "Study workspace": `<x-split weights="2:1" min="240">
  <x-block surface="card" title="How to study a chapter">
    <x-flowchart title="Study loop">flowchart TD
      A("Read a section") --> B["Recall without looking"]
      B --> C{"Can you explain it?"}
      C -->|Not yet| A
      C -->|Yes| D("Practice a question")
    </x-flowchart>
  </x-block>
  <x-block surface="card" title="Focus session">
    <x-timer id="focus" seconds="1500"></x-timer>
    <x-row><button @click="focus.toggle()">Start / pause</button><button @click="focus.reset()">Reset</button></x-row>
    <x-progress :value="focus.elapsed" :max="focus.total" label="Session progress"></x-progress>
    <x-todo add title="Before you finish">- [ ] Explain the main idea
- [ ] Solve one question
- [ ] Write down an uncertainty</x-todo>
  </x-block>
</x-split>`,
    "Independent counters": `<x-split weights="2:1" min="220">
<x-block surface="card" title="First block" x-data="{count:0}"><button @click="count++">First: {{count}}</button><input name="note" placeholder="Your note"></x-block>
<x-block surface="card" title="Second block" x-data="{count:10}"><button @click="count++">Second: {{count}}</button><input name="note" placeholder="An independent note"></x-block>
</x-split>`,
    "Editable keyed list": `<x-block x-data="{items:[{id:1,label:'Read'},{id:2,label:'Recall'},{id:3,label:'Practice'}]}">
<button @click="items.reverse()">Reverse order (keep your notes)</button>
<template x-for="item in items" :key="item.id"><x-card><label>{{item.label}}<input placeholder="Write a note"></label></x-card></template>
</x-block>`,
    "Table and chart": `<x-split weights="1:1" min="260"><x-block title="Results"><x-table sortable data='[{"name":"Ada","score":5},{"score":9,"name":"Lin"},{"name":"Sam","score":7}]'></x-table></x-block><x-chart type="bar" labels="Ada|Lin|Sam" data="5,9,7"></x-chart></x-split>`,
    "Quiz and timeline": `<x-split min="260"><x-block title="Quick check"><x-choice name="answer" options="Recall|Reread|Highlight" answer="Recall" reveal>Which practice directly tests retrieval?</x-choice><x-toggle name="remind" aria-label="Remind me tomorrow"></x-toggle><p>Remind tomorrow: {{remind ? 'Yes' : 'No'}}</p></x-block><x-timeline>Read | First pass | Understand the main claim
Recall | Close the book | Explain it in your words
Practice | Apply it | Solve a new problem</x-timeline></x-split>`,
    "Wide graph stress test": `<x-flowchart direction="right" title="A deliberately wide graph">${Array.from({length:24},(_,i)=>`N${i}["Step ${i+1}: ${i%3===0?'A longer label that should wrap naturally':'Keep going'}"]`).join(' --> ')}</x-flowchart>`,
    "Backend stream (opt-in)": String.raw`<x-block x-data="{output:'',status:'Idle'}"><button @click="status='Running'; output=''; const result = await backendStream('python', 'import time\nfor i in range(3):\n print(i, flush=True)\n time.sleep(0.2)', chunk => { output += chunk }); status = result.ok ? 'Done' : result.out">Run Python</button><p>{{status}}</p><pre>{{output}}</pre></x-block>`,
  };
  let dark = true, revision = 0;
  const jobs = new Map();
  const vars = () => ({ '--bg':dark?'#1f1e1c':'#faf9f6','--fg':dark?'#e8e4dc':'#302e29','--muted':dark?'#9a958c':'#767168','--faint':'#777168','--line':dark?'#ffffff19':'#00000020','--surface':dark?'#ffffff09':'#00000004','--bubble':dark?'#2b2a27':'#f1efea','--float':dark?'#2b2a27':'#ffffff','--accent':'#d97757','--success':'#7c9a6d','--danger':'#c0645a','--r':'12px' });
  const log = (text) => { $('log').textContent = ($('log').textContent + '\n' + text).slice(-12000); };
  const send = (message) => $('preview').contentWindow.postMessage(message, '*');
  const cancelAll = () => { jobs.forEach(c=>c.abort()); jobs.clear(); };
  const run = () => {
    cancelAll(); revision++;
    $('log').textContent = 'New instance. Resize the frame to test adaptation without resetting it.';
    const issues = BlocksSchema.validate($('source').value); issues.forEach(log);
    const css = Object.entries(vars()).map(([k,v])=>`${k}:${v}`).join(';');
    const scripts = ['flow-core','schema','runtime','elements','flowchart'].map(n=>`<script src="${location.origin}/blocks/${n}.js"></script>`).join('');
    $('preview').srcdoc = `<!doctype html><html data-theme="${dark?'dark':'light'}"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${location.origin}/blocks/runtime.css"><style>:root{${css}}</style></head><body class="${$('fill').checked?'fill':''}" data-theme="${dark?'dark':'light'}"><div id="root"></div><script>window.name="lab${revision}";window.BLOCKS_ORIGIN=${JSON.stringify(location.origin)}</script>${scripts}<script>Blocks.connect()</script></body></html>`;
  };
  addEventListener('message', async (e) => {
    const m=e.data, rev=revision;
    if(e.source!==$('preview').contentWindow || m?.src!=='blocks' || m.frame!==`lab${revision}`)return;
    const reply = value => { if(rev===revision)send({type:'reply',id:m.id,value}); };
    if(m.type==='ready')send({type:'source',source:$('source').value,done:true});
    else if(m.type==='issues')m.issues.forEach(log);
    else if(m.type==='error')log('Error: '+m.text);
    else if(m.type==='cancel')jobs.get(m.id)?.abort();
    else if(m.type==='backend' || m.type==='py') {
      if(!$('backend').checked){reply({ok:false,code:1,out:'Backend execution is disabled. Enable it explicitly above the library.'});return;}
      const controller = new AbortController();jobs.set(m.id,controller);
      const timer = setTimeout(()=>controller.abort(),305000);
      try {
        const r=await fetch('/api/blocks',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({backend:m.backend||'python',code:m.code,command:m.command,name:m.name,follow:m.follow,timeout:m.timeout,cwd:m.cwd})});
        if(!r.ok||!r.body)throw new Error(await r.text());
        let data,result={ok:false,code:1,out:'Backend ended without a result'};
        await BlocksNDJSON.readNDJSON(r.body,event=>{
          if(rev!==revision)return;
          if(event.t==='chunk')send({type:'backend-chunk',id:m.id,chunk:event.chunk});
          if(event.t==='data'){data=event.data;send({type:'backend-data',id:m.id,data});}
          if(event.t==='done')result={ok:!!event.ok,code:event.code,out:event.out||'',data};
        });
        reply(m.type==='py'?result.out:result);log('Backend completed.');
      }catch(error){reply({ok:false,code:1,out:String(error)});log('Backend: '+error.message);}
      finally{clearTimeout(timer);jobs.delete(m.id);}
    }else if(['save','upload','lm','open'].includes(m.type)){log(`${m.type}: ${JSON.stringify(m.data||m.target||m.path||'')}. Chat/workspace actions are not executed in the lab.`);reply(false);}
  });
  Object.keys(samples).forEach(name=>{const o=document.createElement('option');o.textContent=name;$('example').append(o);});
  $('example').onchange=()=>{$('source').value=samples[$('example').value];run();};
  $('source').value=Object.values(samples)[0];$('run').onclick=run;
  $('source').onkeydown=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run();}};
  $('fill').onchange=run;$('backend').onchange=()=>{if(!$('backend').checked)cancelAll();};
  $('theme').onclick=()=>{dark=!dark;document.body.classList.toggle('light',!dark);$('theme').textContent=dark?'Light theme':'Dark theme';send({type:'theme',vars:vars(),theme:dark?'dark':'light'});};
  const resize=()=>{ $('viewport').style.width=$('width').value+'px';$('viewport').style.height=$('height').value+'px';};
  $('width').oninput=resize;$('height').oninput=resize;
  document.querySelectorAll('[data-size]').forEach(button=>button.onclick=()=>{[$('width').value,$('height').value]=button.dataset.size.split(',');resize();});
  new ResizeObserver(()=>{$('size').textContent=`${$('viewport').clientWidth} × ${$('viewport').clientHeight}`;}).observe($('viewport'));
  $('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('source').value);log('Source copied.');}catch{log('Clipboard unavailable. Select and copy the source manually.');}};
  $('download').onclick=()=>{const url=URL.createObjectURL(new Blob([$ ('source').value],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='block-source.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('clear').onclick=()=>{$('log').textContent='';};
  const search=()=>{const q=$('search').value.toLowerCase();$('catalog').replaceChildren();const seen=new Set();Object.entries({...BlocksSchema.registry,...BlocksSchema.guides}).filter(([tag,spec])=>(tag+' '+spec.tags).includes(q)).forEach(([tag,spec])=>{if(seen.has(spec.usage))return;seen.add(spec.usage);const a=document.createElement('article'),title=document.createElement('strong'),code=document.createElement('code');title.textContent=tag;code.textContent=spec.usage;a.append(title,code);$('catalog').append(a);});};
  $('search').oninput=search;search();run();
})();
