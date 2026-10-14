const {test}=require('node:test'),assert=require('node:assert/strict');
const handler=import('../api/cron-daily-summary.js').then(module=>module.default);
async function run({authorized=false,approved=true}={}){
  const values={CRON_SECRET:'fixture-cron-secret',PLANNING_SUPABASE_URL:'https://fixture.invalid',PLANNING_SUPABASE_SERVICE_KEY:'fixture-service',PLANNING_OWNER_ID:'owner',PLANNING_OWNER_WHATSAPP_PHONE:'5511999999999',PLANNING_OWNER_WHATSAPP_KEY:'1234567'};
  const old=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
  const saved=global.fetch,calls=[];
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  global.fetch=async(url)=>{calls.push(String(url));if(String(url).includes('/profiles?'))return Response.json([{approved}]);if(String(url).includes('/planejamento_documents?'))return Response.json([{payload:{replacement:[{date:today,title:'APENAS DO PROPRIETÁRIO',from:'08:00',to:'10:00'}],events:[]}}]);return new Response('Message queued')};
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}};
  try{await (await handler)({method:'GET',headers:authorized?{authorization:'Bearer fixture-cron-secret'}:{},query:{type:'morning',user_id:'another-account'}},res);return {res,calls}}
  finally{global.fetch=saved;for(const key of Object.keys(values)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key]}}
}
test('cron refuses anonymous calls without reading data or sending messages',async()=>{const result=await run();assert.equal(result.res.code,401);assert.equal(result.calls.length,0)});
test('cron reads the fixed approved owner private semester, ignoring requested account IDs',async()=>{const result=await run({authorized:true});assert.equal(result.res.code,200);assert.ok(result.calls[1].includes('user_id=eq.owner'));const message=new URL(result.calls[2]).searchParams.get('text');assert.ok(message.includes('APENAS DO PROPRIETÁRIO'));assert.ok(!JSON.stringify(result.res.body).includes('1234567'))});
test('revoking owner approval stops automatic notifications',async()=>{const result=await run({authorized:true,approved:false});assert.equal(result.res.code,403);assert.equal(result.calls.length,1)});
