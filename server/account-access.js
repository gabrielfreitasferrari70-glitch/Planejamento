/* Server-only identity checks for the existing administrator notification features. */
import {timingSafeEqual} from 'node:crypto';
function fail(status){throw Object.assign(new Error('Account verification failed'),{status})}
export async function verifiedOwner(req){
  const authorization=req.headers.authorization||'';
  if(!authorization.startsWith('Bearer '))fail(401);
  const url=process.env.PLANNING_SUPABASE_URL,key=process.env.PLANNING_SUPABASE_PUBLIC_KEY,owner=process.env.PLANNING_OWNER_ID;
  if(!url||!key||!owner)fail(503);
  const headers={Authorization:authorization,apikey:key};
  const response=await fetch(url+'/auth/v1/user',{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail(401);
  const user=await response.json();
  if(user.id!==owner)fail(403);
  const profile=await fetch(url+'/rest/v1/profiles?select=approved&id=eq.'+encodeURIComponent(owner),{headers,signal:AbortSignal.timeout(10000)});
  if(!profile.ok)fail(503);
  const rows=await profile.json();if(rows[0]?.approved!==true)fail(403);
  return user;
}
export function authorizeCron(req){
  if(!['GET','POST'].includes(req.method))return 405;
  const secret=process.env.CRON_SECRET;if(!secret)return 503;
  const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+secret);
  return supplied.length!==expected.length||!timingSafeEqual(supplied,expected)?401:0;
}
export async function ownerDocument(){
  const url=process.env.PLANNING_SUPABASE_URL,key=process.env.PLANNING_SUPABASE_SERVICE_KEY,owner=process.env.PLANNING_OWNER_ID;
  if(!url||!key||!owner)fail(503);
  const headers={Authorization:'Bearer '+key,apikey:key};
  const profile=await fetch(url+'/rest/v1/profiles?select=approved&id=eq.'+encodeURIComponent(owner),{headers,signal:AbortSignal.timeout(10000)});
  if(!profile.ok)fail(503);
  const profiles=await profile.json();if(profiles[0]?.approved!==true)fail(403);
  const response=await fetch(url+'/rest/v1/planejamento_documents?select=payload&user_id=eq.'+encodeURIComponent(owner)+'&limit=1',{headers,signal:AbortSignal.timeout(10000)});
  if(!response.ok)fail(503);
  return (await response.json())[0]||{payload:{}};
}
