const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { launchEnvironment } = require('../scripts/launch-env.cjs');
const { waitForCondition } = require('./helpers.cjs');
const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'studydesk-bubbles-ui-'));
const executable=process.env.STUDYDESK_TEST_EXECUTABLE||(process.platform==='win32'?path.join(root,'release/win-unpacked/StudyDesk.exe'):path.join(root,'release/linux-unpacked/studydesk'));
fs.writeFileSync(path.join(profile,'dafeyu-config.json'),JSON.stringify({enabled:false,fantasy_probability:0,tick_ms:50,contact_plan_min_gap_ms:0,life_enabled:false}));
const environment={...launchEnvironment(executable),STUDYDESK_DATA_DIR:profile,DEEPSEEK_API_KEY:'test-only-key'};
let application,page;
async function launch(){
 application=await electron.launch({executablePath:executable,env:environment,timeout:60000});
 await application.evaluate(({net,powerMonitor})=>{
  const original=net.fetch.bind(net);globalThis.syntheticTriggers=[];
  // Presence guards have separate tests; make this renderer integration deterministic.
  powerMonitor.getSystemIdleTime=()=>0;powerMonitor.getSystemIdleState=()=> 'active';
  net.fetch=async(url,input={})=>{
   if(String(url).startsWith('file:'))return original(url,input);
   if(!String(url).startsWith('https://api.deepseek.com/'))throw Error('Unexpected external request blocked');
   if(String(url).endsWith('/search'))return new Response(JSON.stringify({results:[]}));
   const b=JSON.parse(input.body),c=JSON.parse(b.messages[1].content);globalThis.syntheticTriggers.push(c.trigger);
   const tool=(name,args)=>({id:name,type:'function',function:{name,arguments:JSON.stringify(args)}});
   const first=!b.messages.some(m=>m.role==='tool'),latest=c.dialogue.at(-1)?.content;
   let calls,plan;
   if(c.trigger==='planned')plan={decision:'send',bubbles:[{text:'到期联系第一句',after_ms:100},{text:'到期联系第二句',after_ms:400}]};
   else if(latest==='测试逐条显示'){
    if(first)calls=[tool('unsaid_update',{operations:[{action:'upsert',key:'story',text:'SYNTHETIC_UNSAID_NOT_VISIBLE'}]}),tool('contact_plan_update',{operations:[{action:'upsert',key:'story',intent:'合成的未来联系',after_minutes:1}]})];
    else plan={decision:'send',bubbles:[{text:'第一句。\n换行仍是一个气泡！',after_ms:1000},{text:'第二个气泡稍后才到',after_ms:1300},{text:'  x = 1\n  print(x)',kind:'code',after_ms:1000}]};
   }else if(latest==='这次先不回复')plan={decision:'silent',bubbles:[],resume_after_ms:60000};
   else if(latest==='兴奋连发')plan={decision:'send',bubbles:Array.from({length:6},(_,i)=>({text:'兴奋连发'+i,after_ms:i?120:0}))};
   else if(latest==='中途插话测试')plan={decision:'send',bubbles:[{text:'已经发出的前半句',after_ms:0},{text:'绝不能补发的旧尾巴',after_ms:1800}]};
   else if(latest==='换个话题')plan={decision:'send',bubbles:[{text:'现在接住新话题',after_ms:100}]};
   else if(latest==='暂停等待测试')plan={decision:'send',bubbles:[{text:'已取消的未来气泡',after_ms:1600}]};
   else if(latest==='重启测试')plan={decision:'send',bubbles:[{text:'重启前已经发出',after_ms:0},{text:'重启后只发这一条',after_ms:2000}]};
   else throw Error('Unexpected synthetic test input');
   return new Response(JSON.stringify({choices:[{message:{role:'assistant',content:calls?null:JSON.stringify(plan),reasoning_content:'SYNTHETIC_REASONING_NOT_VISIBLE',...(calls?{tool_calls:calls}:{})},finish_reason:calls?'tool_calls':'stop'}]}),{headers:{'content-type':'application/json'}});
  };
 });
 page=await application.firstWindow();await page.locator('.home-page').waitFor();
}
const state=()=>page.evaluate(()=>window.studyDesk.companionLoad());
const assistant=async()=> (await state()).messages.filter(m=>m.role==='assistant');
const count=async n=>waitForCondition(async()=> (await assistant()).length===n,20000);
const send=text=>page.evaluate(text=>window.studyDesk.companionCommand('chat.send',{content:text}),text);
async function close(){if(application){await application.evaluate(({app})=>{setImmediate(()=>app.quit());}).catch(()=>{});await application.close();application=null;}}
(async()=>{
 try{
  await launch();await page.evaluate(()=>window.studyDesk.companionCommand('engine.start'));
  await send('测试逐条显示');await waitForCondition(async()=> (await state()).waiting);
  assert.equal((await assistant()).length,0);assert.ok(!(await page.locator('#companion-chat').innerText()).includes('第二个气泡稍后才到'));
  await count(1);await waitForCondition(async()=>await page.locator('.chat-message.assistant .chat-bubble').count()===1);assert.equal(await page.locator('.chat-message.assistant .chat-bubble').count(),1);
  assert.equal(await page.locator('.chat-message.assistant .chat-message-body').innerText(),'第一句。\n换行仍是一个气泡！');
  assert.ok(!JSON.stringify(await state()).includes('第二个气泡稍后才到'));assert.equal(await page.locator('.chat-typing').count(),0);
  await count(2);await waitForCondition(async()=>await page.locator('.chat-message.assistant .chat-bubble').count()===2);assert.equal(await page.locator('.chat-message.assistant .chat-bubble').count(),2);
  await count(3);const first=await assistant();assert.ok(first[1].created_at-first[0].created_at>=1300);assert.ok(first[2].created_at-first[1].created_at>=1000);
  assert.equal(await page.locator('.chat-message.assistant pre code').textContent(),'  x = 1\n  print(x)');
  const db=new DatabaseSync(path.join(profile,'dafeyu.sqlite'));db.exec('PRAGMA busy_timeout=5000');const plans=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='contact_plans'").get().value);plans.items[0].due_at=Date.now()-100;plans.revision++;db.prepare("UPDATE metadata SET value=? WHERE key='contact_plans'").run(JSON.stringify(plans));db.close();
  await count(5);assert.ok((await application.evaluate(()=>globalThis.syntheticTriggers)).includes('planned'));
  await send('这次先不回复');await waitForCondition(async()=>{const s=await state();return !s.busy&&!s.waiting;});assert.equal((await assistant()).length,5);
  await send('兴奋连发');await count(11);await waitForCondition(async()=>await page.locator('.chat-message.assistant .chat-bubble').count()===11);assert.equal(await page.locator('.chat-message.assistant .chat-bubble').count(),11);
  await send('中途插话测试');await count(12);await send('换个话题');await count(13);await page.waitForTimeout(2000);assert.equal((await assistant()).length,13);
  assert.ok(!(await page.locator('#companion-chat').innerText()).includes('绝不能补发的旧尾巴'));
  await send('暂停等待测试');await waitForCondition(async()=> (await state()).waiting);assert.ok(await page.getByRole('button',{name:'暂停聊天',exact:true}).count());
  await page.evaluate(()=>window.studyDesk.companionCommand('chat.stop'));await page.waitForTimeout(1800);assert.equal((await assistant()).length,13);
  await send('重启测试');await count(14);await close();await launch();await count(15);
  const messages=await assistant();assert.equal(messages.filter(m=>m.content==='重启前已经发出').length,1);assert.equal(messages.filter(m=>m.content==='重启后只发这一条').length,1);
  const ui=await page.locator('#companion-chat').innerText();assert.ok(!ui.includes('SYNTHETIC_UNSAID_NOT_VISIBLE'));assert.ok(!ui.includes('SYNTHETIC_REASONING_NOT_VISIBLE'));assert.ok(!ui.includes('"decision"'));
  console.log('Packaged bubble chat passed: individual DOM arrivals, model intervals and boundaries, burst, silence, planned contact, interruption, pause and restart without duplicate bubbles. All API responses were synthetic.');
 }finally{await close();fs.rmSync(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
