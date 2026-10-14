const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const handlerPromise=import('../api/send-whatsapp.js').then(module=>module.default);
async function run({approved=true,owner='other',key='',authorized=true}={}){
  const names=['PLANNING_SUPABASE_URL','PLANNING_SUPABASE_PUBLIC_KEY','PLANNING_OWNER_ID','PLANNING_OWNER_WHATSAPP_PHONE','PLANNING_OWNER_WHATSAPP_KEY'];
  const previous=names.map(name=>process.env[name]);
  Object.assign(process.env,{PLANNING_SUPABASE_URL:'https://fixture.invalid',PLANNING_SUPABASE_PUBLIC_KEY:'fixture-public',PLANNING_OWNER_ID:'owner',PLANNING_OWNER_WHATSAPP_PHONE:'5511999999999',PLANNING_OWNER_WHATSAPP_KEY:'1234567'});
  const savedFetch=global.fetch,calls=[];
  global.fetch=async(url)=>{calls.push(String(url));return String(url).includes('/auth/v1/user')?Response.json({id:owner}):String(url).includes('/rest/v1/profiles')?Response.json([{approved}]):new Response('Message queued')};
  const res={headers:{},setHeader(key,value){this.headers[key]=value},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  try{await (await handlerPromise)({method:'POST',headers:authorized?{authorization:'Bearer fixture-token'}:{},body:{phone:'5511999999999',text:'Resumo de teste',apikey:key}},res);return {res,calls}}
  finally{global.fetch=savedFetch;names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i]})}
}
test('anonymous and pending accounts cannot trigger messaging',async()=>{
  const anonymous=await run({authorized:false});assert.equal(anonymous.res.code,401);assert.equal(anonymous.calls.length,0);
  const pending=await run({owner:'owner',approved:false,key:'7654321'});assert.equal(pending.res.code,403);assert.equal(pending.calls.length,2);
});
test('another account never inherits the owner messaging credential',async()=>{
  const other=await run();assert.equal(other.res.code,403);assert.equal(other.calls.length,1);
  const ownConfig=await run({key:'7654321'});assert.equal(ownConfig.res.code,403);assert.equal(ownConfig.calls.length,1);
});
test('the owner configuration remains on the server and is not returned',async()=>{
  const owner=await run({owner:'owner'});assert.equal(owner.res.code,200);assert.ok(owner.calls[2].includes('apikey=1234567'));assert.equal(owner.res.body.success,true);assert.ok(!JSON.stringify(owner.res.body).includes('1234567'));
});
