const {launch,AxeBuilder,BASE_URL,OUT}=require('./browser-env.cjs');
const path=require('node:path');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const KEY='briix-media-v1';
const read=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k))||{jobs:[]},KEY);
// Клик по «Создать» пишет задачу в localStorage после рендера. На медленном раннере
// чтение сразу после клика застаёт предыдущее состояние — отсюда «40 !== 39» в тесте
// вытеснения. Ждём, пока верхней задачей станет новая, и только потом читаем.
const generate=async p=>{
 const prev=await p.evaluate(k=>(JSON.parse(localStorage.getItem(k)||'{}').jobs||[])[0]?.id||'',KEY);
 await p.locator('#media-generate').click();
 await p.waitForFunction(({k,prev})=>{const jobs=JSON.parse(localStorage.getItem(k)||'{}').jobs||[];return jobs[0]&&jobs[0].id!==prev;},{k:KEY,prev},{timeout:10000});
 return read(p);
};
const waitReady=(p,id)=>p.waitForFunction(({k,id})=>JSON.parse(localStorage.getItem(k)).jobs.find(j=>j.id===id)?.status==='ready',{k:KEY,id},{timeout:12000});
(async()=>{
 const b=await launch(); const results=[];
 const ok=(name,data={})=>{results.push({name,...data});console.log('PASS',name,JSON.stringify(data));};
 const c=await b.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});await c.newPage();const p=c.pages()[0];const errors=[];const external=[];
 p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(BASE_URL)&&!r.url().startsWith('data:'))external.push(r.url())});
 await p.goto(`${BASE_URL}/#/media`);await p.waitForSelector('.media-page');
 // Validation, references metadata only, prompt cap.
 await p.locator('#media-prompt').fill('коротко');await p.locator('#media-generate').click();assert.equal(await p.locator('#media-prompt').getAttribute('aria-invalid'),'true');assert.equal((await read(p)).jobs.length,0);ok('short prompt rejected');
 await p.locator('#media-prompt').fill('Проверочный бриф с достаточно длинным описанием света и композиции.');
 await p.locator('.media-extra summary').click();
 await p.locator('#media-reference-input').setInputFiles([{name:'bad.txt',mimeType:'text/plain',buffer:Buffer.from('x')}]);assert.equal(await p.locator('.media-reference-chip').count(),0);
 await p.locator('#media-reference-input').setInputFiles([{name:'big.png',mimeType:'image/png',buffer:Buffer.alloc(10485761)}]);assert.equal(await p.locator('.media-reference-chip').count(),0);
 await p.locator('#media-reference-input').setInputFiles([1,2,3,4].map(i=>({name:`ref-${i}.png`,mimeType:'image/png',buffer:Buffer.from('not really an image')})));assert.equal(await p.locator('.media-reference-chip').count(),3);ok('reference type/size/count limits');
 await p.locator('#media-project').fill('Фото <b>проект</b>');let s=await generate(p);const photo=s.jobs[0];assert.equal(photo.references.length,3);assert.ok(!JSON.stringify(photo).includes('not really'));await waitReady(p,photo.id);assert.equal(await p.locator('.media-preview-head b').count(),0);ok('photo job and escaped project');
 // Download every image ratio through actual browser download.
 for(const ratio of ['1:1','4:5','16:9','9:16']){
   await p.locator(`[data-media-action="ratio"][data-id="${ratio}"]`).click();s=await generate(p);const j=s.jobs[0];await waitReady(p,j.id);
   const box=await p.locator('.media-preview-frame img').boundingBox();assert.ok(Math.abs(box.width/box.height-Number(ratio.split(':')[0])/Number(ratio.split(':')[1]))<0.01);
   const dl=p.waitForEvent('download');await p.locator('.media-preview-actions [data-media-action="detail"]').click();await p.locator('#modal [data-modal-action="2"]').click();const d=await dl;const file=path.join(OUT,`briix-download-${ratio.replace(':','x')}.jpg`);await d.saveAs(file);assert.ok(d.suggestedFilename().endsWith('.jpg'));await p.locator('#modal [data-action="close-modal"]').click();
   ok('image preview/download '+ratio,{box:[Math.round(box.width),Math.round(box.height)],file});
 }
 // Video both orientations, actual playback, modal pause and download.
 await p.locator('[data-media-action="type"][data-id="video"]').click();
 for(const ratio of ['16:9','9:16']){
   await p.locator(`[data-media-action="ratio"][data-id="${ratio}"]`).click();s=await generate(p);const j=s.jobs[0];await waitReady(p,j.id);
   await p.waitForFunction(()=>{const v=document.querySelector('.media-preview-frame video');return v&&v.readyState>=2},{},{timeout:8000});
   const meta=await p.locator('.media-preview-frame video').evaluate(v=>({duration:v.duration,w:v.videoWidth,h:v.videoHeight,src:v.currentSrc}));assert.equal(meta.duration,5);assert.equal(meta.w/ratio.split(':')[0]*Number(ratio.split(':')[1]),meta.h);
   await p.locator('.media-preview-frame video').evaluate(v=>v.play());await p.waitForFunction(()=>document.querySelector('.media-preview-frame video').currentTime>0.25);const time=await p.locator('.media-preview-frame video').evaluate(v=>v.currentTime);await p.locator('.media-preview-frame video').evaluate(v=>v.pause());
   const dl=p.waitForEvent('download');await p.locator('.media-preview-actions [data-media-action="detail"]').click();await p.locator('#modal [data-modal-action="2"]').click();const d=await dl;assert.ok(d.suggestedFilename().endsWith('.mp4'));await d.saveAs(path.join(OUT,`briix-download-${ratio.replace(':','x')}.mp4`));
   await p.locator('#modal [data-action="close-modal"]').click();ok('video playback/download '+ratio,{meta,time});
 }
 // WebM fallback: hide MP4 support before app loads.
 const c2=await b.newContext({viewport:{width:1200,height:900},reducedMotion:'reduce'});await c2.route('**/*.mp4',route=>route.abort());await c2.newPage();const p2=c2.pages()[0];await p2.goto(`${BASE_URL}/#/media`);await p2.locator('[data-media-action="type"][data-id="video"]').click();await p2.locator('#media-generate').click();await p2.waitForFunction(()=>JSON.parse(localStorage.getItem('briix-media-v1')).jobs[0].status==='ready');await p2.waitForFunction(()=>document.querySelector('video')?.readyState>=2);const fallback=await p2.locator('video').evaluate(v=>({src:v.currentSrc,duration:v.duration}));assert.ok(fallback.src.endsWith('.webm'));await p2.locator('video').evaluate(v=>v.play());await p2.waitForFunction(()=>document.querySelector('video').currentTime>0.2);ok('WebM fallback playback',fallback);await c2.close();
 // Populated image label must be readable over any still, not only an empty preview.
 await p.locator('[data-media-action="tab"][data-id="create"]').click();await p.locator('[data-media-action="type"][data-id="image"]').click();await p.locator('#media-generate').click();await p.waitForFunction(()=>JSON.parse(localStorage.getItem('briix-media-v1')).jobs[0].status==='ready');await p.waitForFunction(()=>document.querySelector('.media-preview-frame img')?.complete);for(const theme of ['light','dark']){if(theme==='dark')await p.locator('[data-action="toggle-theme"]').click();const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();assert.deepEqual(r.violations.map(v=>v.id),[],'populated image label '+theme)}await p.locator('[data-action="toggle-theme"]').click();ok('populated image label contrast');
 // Library search/filter/favorite/reuse/delete/export.
 await p.locator('[data-media-action="tab"][data-id="library"]').click();await p.locator('[data-media-action="library-filter"][data-id="video"]').click();assert.equal(await p.locator('.media-library-card').count(),2);await p.locator('#media-library-search').fill('несуществующий запрос');assert.equal(await p.locator('.media-library-card').count(),0);await p.locator('[data-media-action="reset-filter"]').click();assert.equal(await p.locator('.media-library-card').count(),8);
 await p.locator('[data-media-action="favorite"]').first().click();await p.locator('[data-media-action="library-filter"][data-id="favorite"]').click();assert.equal(await p.locator('.media-library-card').count(),1);await p.locator('[data-media-action="reuse"]').first().click();assert.equal(await p.locator('#media-brief-form').count(),1);ok('library filters/search/favorite/reuse');
 const dl=p.waitForEvent('download');await p.locator('[data-media-action="tab"][data-id="library"]').click();await p.locator('[data-media-action="export"]').click();const exp=await dl;const expPath=path.join(OUT,'briix-media-export.json');await exp.saveAs(expPath);const exported=JSON.parse(fs.readFileSync(expPath,'utf8'));assert.equal(exported.jobs.length,8);assert.ok(exported.notice.includes('No model inference'));ok('brief export');
 await p.locator('[data-media-action="delete"]').first().click();await p.locator('#modal [data-modal-action="1"]').click();assert.equal((await read(p)).jobs.length,7);ok('delete confirmation');
 // Error/cancel/retry and reload recovery.
 await p.locator('[data-media-action="tab"][data-id="create"]').click();await p.locator('#media-fail').check();s=await generate(p);const fail=s.jobs[0];await p.waitForFunction(({k,id})=>JSON.parse(localStorage.getItem(k)).jobs.find(j=>j.id===id)?.status==='error',{k:KEY,id:fail.id},{timeout:12000});await p.locator('[data-media-action="tab"][data-id="queue"]').click();await p.locator(`[data-media-action="retry"][data-id="${fail.id}"]`).click();s=await read(p);const retried=s.jobs[0];assert.equal(retried.fail,false);await waitReady(p,retried.id);ok('simulated error and retry');
 await p.locator('[data-media-action="tab"][data-id="create"]').click();s=await generate(p);const cancel=s.jobs[0];await p.locator('[data-media-action="tab"][data-id="queue"]').click();await p.locator(`[data-media-action="cancel"][data-id="${cancel.id}"]`).click();assert.equal((await read(p)).jobs.find(j=>j.id===cancel.id).status,'cancelled');ok('cancel');
 await p.locator('[data-media-action="tab"][data-id="create"]').click();s=await generate(p);const reloadJob=s.jobs[0];await p.waitForTimeout(250);await p.reload();await p.waitForSelector('.media-page');s=await read(p);assert.equal(s.jobs.find(j=>j.id===reloadJob.id).status,'queued');await waitReady(p,reloadJob.id);ok('running job recovered after reload');
 // Capacity: seed 40 jobs, 6 active, all favorites; submit must not hang or evict protected.
 await p.evaluate(k=>{const jobs=Array.from({length:40},(_,i)=>({id:'seed-'+i,type:'image',recipe:'product-photo',asset:'ceramic',goal:'product',ratio:'1:1',project:'Защита '+i,prompt:'Проверочный бриф для limite.capacity.',status:i<6?'queued':'ready',progress:0,favorite:true,createdAt:Date.now()-i,startedAt:null,fail:false,references:[]}));localStorage.setItem(k,JSON.stringify({version:1,jobs}));window.BRIIX_MEDIA.suspend=()=>{}},KEY);await p.reload();await p.waitForSelector('.media-page');assert.equal(await p.locator('#media-generate').isDisabled(),true);await p.evaluate(()=>document.querySelector('#media-brief-form').requestSubmit());assert.equal((await read(p)).jobs.length,40);ok('active limit and protected capacity');
 // 40 settled unprotected -> eviction terminates and keeps 40.
 await p.evaluate(k=>{const s=JSON.parse(localStorage.getItem(k));s.jobs.forEach((j,i)=>{j.status='ready';j.favorite=i===0;j.progress=100});localStorage.setItem(k,JSON.stringify(s));window.BRIIX_MEDIA.suspend=()=>{}},KEY);await p.reload();await p.waitForSelector('.media-page');s=await generate(p);assert.equal(s.jobs.length,40);assert.ok(s.jobs.some(j=>j.id==='seed-0'));assert.equal(s.jobs.filter(j=>j.id.startsWith('seed-')).length,39);assert.ok(s.jobs[0].id.startsWith('media-'));ok('bounded eviction preserves favorites');
 // Retry at capacity must also stay <=40 and remain reloadable.
 await p.evaluate(k=>{const jobs=Array.from({length:40},(_,i)=>({id:'retry-seed-'+i,type:'image',recipe:'product-photo',asset:'ceramic',goal:'product',ratio:'1:1',project:'R'+i,prompt:'Проверочный бриф для retry capacity.',status:i===39?'cancelled':'ready',progress:i===39?0:100,favorite:i!==39,createdAt:Date.now()-i,startedAt:null,fail:false,references:[]}));localStorage.setItem(k,JSON.stringify({version:1,jobs}));window.BRIIX_MEDIA.suspend=()=>{}},KEY);await p.reload();await p.waitForSelector('.media-page');await p.locator('[data-media-action="tab"][data-id="queue"]').click();await p.locator('[data-media-action="retry"][data-id="retry-seed-39"]').click();s=await read(p);assert.equal(s.jobs.length,40);assert.ok(!s.jobs.some(j=>j.id==='retry-seed-39'));await p.reload();await p.waitForSelector('.media-page');assert.equal(await p.locator('#media-storage-notice').isVisible(),false);ok('retry capacity remains reloadable');
 // Corrupt storage protected, clear resets protection.
 await p.evaluate(k=>{window.BRIIX_MEDIA.suspend();window.BRIIX_MEDIA.suspend=()=>{};localStorage.setItem(k,'{broken')},KEY);await p.reload();await p.waitForSelector('.media-page');await p.locator('#media-storage-notice').waitFor({state:'visible',timeout:10000});assert.equal(await p.locator('#media-storage-notice').isVisible(),true);assert.equal(await p.evaluate(k=>localStorage.getItem(k),KEY),'{broken');await p.locator('#media-generate').click();assert.equal(await p.evaluate(k=>localStorage.getItem(k),KEY),'{broken');await p.locator('[data-media-action="tab"][data-id="library"]').click();await p.locator('[data-media-action="clear"]').click();await p.locator('#modal [data-modal-action="2"]').click();assert.deepEqual((await read(p)).jobs,[]);ok('corrupt storage protected and explicit clear recovery');
 // Keyboard tabs and modal focus.
 // Клавиатурная навигация. Порядок вкладок берём из DOM, а не из хардкода: если окружение
 // отдало другой набор, тест обязан сказать, какой именно, а не висеть 30 секунд на локаторе.
 const tabState=async()=>p.evaluate(()=>({href:location.href,ids:[...document.querySelectorAll('.media-tab')].map(t=>t.id),selected:document.querySelector('.media-tab[aria-selected="true"]')?.id||null,active:document.activeElement?.id||null,modal:!!document.querySelector('#modal[open]'),showcaseModule:!!window.BRIIX_SHOWCASE}));
 await p.waitForSelector('.media-tabs',{timeout:10000});
 let tabs=await tabState();
 assert.ok(tabs.ids.includes('media-tab-showcase'),`вкладка галереи отсутствует в DOM: ${JSON.stringify(tabs)}`);
 assert.equal(tabs.modal,false,`клавиатурная навигация при открытом модальном окне: ${JSON.stringify(tabs)}`);
 const selectedAfter=async(key,expected,ticket)=>{
   await p.locator('#'+ticket).focus();
   await p.keyboard.press(key);
   try{await p.waitForFunction(id=>document.querySelector('.media-tab[aria-selected="true"]')?.id===id,expected,{timeout:5000});}
   catch{throw new Error(`клавиша ${key} не выбрала ${expected}: ${JSON.stringify(await tabState())}`);}
 };
 await selectedAfter('ArrowRight','media-tab-library','media-tab-create');
 await selectedAfter('End',tabs.ids.at(-1),'media-tab-library');
 await selectedAfter('ArrowLeft','media-tab-models',tabs.ids.at(-1));
 await selectedAfter('Home','media-tab-create','media-tab-models');
 ok('tab keyboard navigation',{tabs:tabs.ids});
 await p.locator('[data-media-action="help"]').click();await p.waitForTimeout(80);assert.equal(await p.evaluate(()=>document.activeElement.getAttribute('data-action')),'close-modal');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.dataset.mediaAction),'help');ok('help modal focus/escape');
 // Responsive/axe across tabs and themes.
 const axe=[];for(const width of [390,768,1024,1440]){await p.setViewportSize({width,height:900});for(const tab of ['create','library','queue','models','showcase']){await p.locator(`[data-media-action="tab"][data-id="${tab}"]`).click();const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false,`overflow ${width} ${tab}`);if(width===390||width===1440){const r=await new AxeBuilder({page:p}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();axe.push({width,tab,violations:r.violations.map(v=>v.id)});}}}
 assert.ok(axe.every(a=>!a.violations.length));ok('responsive and axe',axe);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);ok('no page errors or external requests');
 fs.writeFileSync(path.join(OUT,'briix-media-edge.json'),JSON.stringify(results,null,2));await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
