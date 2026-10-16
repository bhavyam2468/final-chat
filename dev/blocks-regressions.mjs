export const regressions = [
  {
    name: "regression object table uses column keys",
    src: `<x-table sortable data='[{"name":"Ada","score":5},{"score":9,"name":"Lin"}]'></x-table>`,
    steps: [{eval:()=>{document.querySelectorAll('th')[1].dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}}],
    expect: () => [...document.querySelectorAll('tbody tr')].map(r=>r.innerText.replace(/\s+/g,' ').trim()).join('|') === 'Ada 5|Lin 9' && document.querySelectorAll('th')[1].getAttribute('aria-sort') === 'ascending',
  },
  {
    name: "regression CSV quotes and newlines",
    src: `<x-table>name,note\nAda,"one,two"\nLin,"said ""hello""\nnext"</x-table>`,
    expect: () => document.querySelectorAll('tbody tr').length===2 && document.querySelectorAll('tbody td')[1].textContent==='one,two' && document.querySelectorAll('tbody td')[3].textContent==='said "hello"\nnext',
  },
  {
    name: "regression form collection stays inside form",
    src: `<form id="a"><input name="person" value="Ada"></form><form id="b"><input name="person" value="Lin"></form>`,
    expect: () => form('#a').person==='Ada' && form('#b').person==='Lin',
  },
  {
    name: "regression local state independent with streaming",
    src: `<div x-data="{count:1}"><button id="a" @click="count++">{{count}}</button></div><div x-data="{count:2}"><button id="b" @click="count++">{{count}}</button></div>`,
    steps: [{click:'#b'}],
    expect:()=>document.querySelector('#a').textContent==='1' && document.querySelector('#b').textContent==='3',
  },
  {
    name: "regression block named inputs and refs scoped",
    src: `<x-split weights="2:1" min="200"><x-block id="left" x-data="{count:1}"><input name="person" value="Ada"><button @click="count++; $refs.result.textContent = person + count" x-ref="action">Go</button><output id="leftResult" x-ref="result"></output></x-block><x-block id="right" x-data="{count:2}"><input name="person" value="Lin"><button @click="count++; $refs.result.textContent = person + count">Go</button><output id="rightResult" x-ref="result"></output></x-block></x-split>`,
    steps:[{click:'#right button'}],
    expect:()=>document.querySelector('#leftResult').textContent==='' && document.querySelector('#rightResult').textContent==='Lin3' && form('#right').person==='Lin',
  },
  {
    name:"regression keyed repeat keeps node input focus",
    src:`<div x-data="{items:[{id:'a',label:'A'},{id:'b',label:'B'}]}"><template x-for="item in items" :key="item.id"><label :data-key="item.id">{{item.label}}<input></label></template><button id="reverse" @click="items.reverse()">Reverse</button></div>`,
    steps:[{type:['[data-key=a] input','typed A']},{eval:()=>{window.savedInput=document.querySelector('[data-key=a] input');document.querySelector('#reverse').click();}}],
    expect:()=>document.querySelectorAll('label')[0].dataset.key==='b' && document.querySelector('[data-key=a] input')===window.savedInput && window.savedInput.value==='typed A' && document.activeElement===window.savedInput,
  },
  {
    name:"regression removed timer stops ticking",
    src:`<x-timer id="timer" seconds="10" autostart></x-timer>`,
    steps:[{eval:()=>{window.oldTimer=document.querySelector('x-timer');window.tickCount=0;oldTimer.addEventListener('tick',()=>tickCount++);oldTimer.remove();},wait:100},{eval:()=>{window.beforeCount=tickCount;},wait:700}],
    expect:()=>!oldTimer.running && beforeCount===tickCount,
  },
  {
    name:"regression progress and switch accessibility",
    src:`<x-progress value="0.5" label="Lesson progress"></x-progress><x-toggle id="toggle" aria-label="Notifications"></x-toggle>`,
    steps:[{click:'#toggle'}],
    expect:()=>document.querySelector('x-progress').getAttribute('role')==='progressbar' && document.querySelector('x-progress').getAttribute('aria-valuenow')==='0.5' && document.querySelector('x-toggle').getAttribute('aria-checked')==='true',
  },
  {
    name:"regression multiple aside cards never overlap",width:1000,
    src:`<style type="rel">.side {place:end}</style><x-card>Main</x-card><x-card class="side">One</x-card><x-card class="side">Two</x-card>`,
    expect:()=>{const [a,b]=[...document.querySelectorAll('.side')].map(e=>e.getBoundingClientRect());return a.bottom<=b.top || b.bottom<=a.top;},
  },
  {
    name:"regression weight independent of type",
    src:`<style type="rel">.a {weight:2} .b {weight:1}</style><x-row><x-card class="a">A</x-card><x-card class="b">B</x-card></x-row>`,
    expect:()=>getComputedStyle(document.querySelector('.a')).fontSize===getComputedStyle(document.querySelector('.b')).fontSize && getComputedStyle(document.querySelector('.a')).flexGrow==='2',
  },
  {
    name:"regression nested split adapts to own width",width:900,
    src:`<x-split weights="2:1" min="180"><x-block id="large">Main</x-block><x-split id="nested" min="200"><x-card>A</x-card><x-card>B</x-card></x-split></x-split>`,
    expect:()=>document.querySelector('#nested').dataset.stacked==='true' && document.querySelector('x-split').dataset.stacked==='false' && document.documentElement.scrollWidth<=innerWidth,
  },
  {
    name:"regression narrow composition",width:240,
    src:`<x-split weights="2:1" min="160"><x-block>Long study explanation and notes</x-block><x-card>Supporting material</x-card></x-split>`,
    expect:()=>document.querySelector('x-split').dataset.stacked==='true' && document.documentElement.scrollWidth<=innerWidth,
  },
  {
    name:"regression native flowchart real worker",wait:1800,
    src:`<x-flowchart title="Study loop">flowchart LR\nA("Read") --> B{"Ready?"}; B -->|Yes| C["Practice"]; B -->|No| A; C --> D("Done")</x-flowchart>`,
    steps:[{click:'[data-act=fit]'},{eval:()=>document.querySelector('[data-node=B]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))}],
    expect:()=>document.querySelectorAll('.flow-node').length===4 && document.querySelectorAll('.flow-edge').length===4 && document.querySelector('x-flowchart').value==='B' && !document.querySelector('x-flowchart').hasAttribute('aria-busy') && document.querySelectorAll('.flow-outline li').length===4,
  },
  {
    name:"regression wide flow remains readable",width:280,wait:1800,
    src:`<x-flowchart direction="right">${Array.from({length:18},(_,i)=>`N${i}["Lesson ${i}"]`).join('-->')}</x-flowchart>`,
    expect:()=>document.querySelectorAll('.flow-node').length===18 && +document.querySelector('output').textContent.replace('%','')>=80 && document.documentElement.scrollWidth<=innerWidth,
  },
  {
    name:"regression tabs keyboard navigation",
    src:`<x-tabs><x-tab label="First">One</x-tab><x-tab label="Second">Two</x-tab></x-tabs>`,
    steps:[{eval:()=>document.querySelector('[role=tab]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))}],
    expect:()=>document.querySelectorAll('[role=tab]')[1].getAttribute('aria-selected')==='true' && !document.querySelectorAll('x-tab')[1].hidden,
  },
];
regressions.push({
  name:'regression keyed repeated local blocks keep state',
  src:`<x-block x-data="{items:[{id:'a',count:1},{id:'b',count:2}]}"><x-block each="item in items" :key="item.id" :data-key="item.id" x-data="{count:item.count}"><button @click="count++">{{item.id}}:{{count}}</button></x-block><button id="reverse" @click="items.reverse()">Reverse</button></x-block>`,
  steps:[{click:'[data-key=a] button'},{click:'#reverse'}],
  expect:()=>document.querySelector('[data-key=a] button').textContent==='a:2' && document.querySelector('[data-key=b] button').textContent==='b:2' && document.querySelector('[data-key]').dataset.key==='b',
});
regressions.push({
  name:'regression upload MIME cannot overwrite bridge message type',
  src:`<x-upload name="file"></x-upload>`,
  steps:[{eval:()=>{
    const original=window.parent.postMessage;
    window.parent.postMessage=(m,...args)=>{
      if(m.type==='upload') {
        window.lastUpload=m;
        window.dispatchEvent(new MessageEvent('message',{source:window,data:{type:'reply',id:m.id,value:{path:'uploads/test.txt'}}}));
      } else original(m,...args);
    };
    Blocks.upload(new File(['test'],'test.txt',{type:'text/plain'}),'uploads').then(r=>window.uploadResult=r);
  }}],
  expect:()=>window.lastUpload?.type==='upload' && lastUpload.mime==='text/plain' && window.uploadResult?.path==='uploads/test.txt',
});
