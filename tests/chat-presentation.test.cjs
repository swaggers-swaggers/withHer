const {test}=require('node:test');const assert=require('node:assert/strict');
const {presentMessage}=require('../electron/chat-presentation.cjs');
const reply=(text='正在学习 flow matching',id='owner')=>({type:'reply',data:{target_message_id:'source-1',target_message_content:text,target_message_sender_id:id,target_message_sender_nickname:'来源昵称'}});
const show=(content,parts)=>presentMessage({content,segments_json:JSON.stringify(parts)});
test('structured quote is separate from body without changing stored native text',()=>{
 const raw='正在学习 flow matching 行，学完回来讲给我听';const m=show(raw,[reply(),{type:'text',data:'行，学完回来讲给我听'}]);
 assert.equal(m.content,raw);assert.equal(m.displayContent,'行，学完回来讲给我听');assert.deepEqual(m.quotes,[{messageId:'source-1',author:'你',content:'正在学习 flow matching'}]);
});
test('ordinary long text and inline quotations are never guessed or shortened',()=>{
 const raw='他说“不晓得”，我继续解释。\n'.repeat(600);assert.equal(show(raw,[]).displayContent,raw);assert.deepEqual(show(raw,[]).quotes,[]);
});
test('a reply body repeating the quoted words remains intact',()=>{
 const m=show('相同原话 相同原话，后面才是回答。',[reply('相同原话'),{type:'text',data:'相同原话，后面才是回答。'}]);assert.equal(m.displayContent,'相同原话，后面才是回答。');
});
test('bot reference author and multiple text segments retain order',()=>{
 const m=show('旧话 第一段\n\n第二段',[reply('旧话','self'),{type:'text',data:'第一段\n\n'},{type:'text',data:'第二段'}]);assert.equal(m.quotes[0].author,'大肥鱼');assert.equal(m.displayContent,'第一段\n\n第二段');
});
test('a reference with missing source stays identifiable without duplicating the body',()=>{
 const m=show('原消息',[{type:'reply',data:{target_message_id:'missing'}}]);assert.equal(m.displayContent,'');assert.equal(m.quotes[0].content,'');
});
test('quoted attachments remain visible without printing binary data',()=>{
 const m=show('旧话 [图片]',[reply('旧话'),{type:'image',data:'data:image/png;base64,private-binary'}]);assert.equal(m.displayContent,'[图片]');assert.equal(m.displayContent.includes('base64'),false);
});
test('unstructured historic messages and invalid component caches preserve their original text',()=>{
 assert.equal(presentMessage({content:'历史正文',segments_json:'invalid'}).displayContent,'历史正文');assert.equal(presentMessage({content:'正文',segments_json:'{}'}).displayContent,'正文');
});
const {splitDisplayText}=require('../electron/chat-presentation.cjs');
test('long content becomes shorter bubbles exactly once without losing punctuation or brackets',()=>{
 const raw=('这一句有完整标点（括号不能被清理），也不能凭空生成错字。\n\n').repeat(90)+'最后一句。';
 const parts=splitDisplayText(raw);assert.ok(parts.length>1);assert.equal(parts.join(''),raw.replace(/\r\n|[\r\n]/g,''));assert.ok(parts.every(p=>!/[\r\n]/.test(p)));
});
test('code and math split at every newline while original markup remains stored',()=>{
 const code='```python\n'+('print("不要在代码中间切开")\n'.repeat(60))+'```\n';const math='$$\n'+('x+y=z\\n'.repeat(70))+'\n$$\n';const raw='说明。\n'+code+'后文。\n'+math+'结尾。';
 const parts=splitDisplayText(raw);assert.ok(parts.every(p=>!/[\r\n]/.test(p)));assert.ok(parts.includes('print("不要在代码中间切开")'));const shown=show(raw,[]);assert.equal(shown.content,raw);assert.equal(shown.displayKinds.filter(k=>k==='code').length,60);
});
test('an unpunctuated long unit is kept whole rather than cut at an arbitrary character',()=>{
 const raw='没有任何可以自然分开的标点'.repeat(120);assert.deepEqual(splitDisplayText(raw),[raw]);
});
test('display splitting never creates extra logical messages or repeats the quote card',()=>{
 const raw='完整的一句回复。\n'.repeat(160);const m=show('旧话 '+raw,[reply('旧话'),{type:'text',data:raw}]);assert.equal(m.displayParts.join(''),raw.replace(/\n/g,''));assert.ok(m.displayParts.length>1);assert.equal(m.quotes.length,1);assert.equal(m.content,'旧话 '+raw);
});

test('every newline including CRLF, bare CR and Unicode separators starts a new bubble without blank bubbles',()=>{
 const raw='第一行\n\n第二行\r\n第三行\r第四行\u2028第五行\u2029第六行';
 assert.deepEqual(splitDisplayText(raw),['第一行','第二行','第三行','第四行','第五行','第六行']);
});
test('both user and assistant messages use identical newline boundaries and keep code indentation',()=>{
 for(const role of ['user','assistant']){const m=presentMessage({role,content:'开头\n```python\n  x = 1\n  print(x)\n```\n结尾'});assert.deepEqual(m.displayParts,['开头','  x = 1','  print(x)','结尾']);assert.deepEqual(m.displayKinds,['text','code','code','text']);}
});
