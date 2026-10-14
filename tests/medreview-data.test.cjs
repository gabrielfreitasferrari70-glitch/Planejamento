const test=require('node:test');
const assert=require('node:assert/strict');
const {summarize}=require('../medreview-data.js');
const user='owner';
const decks=[{id:'folder',title:'Fisiologia',parent:null},{id:'a',title:'Cardiovascular',parent:'folder'},{id:'b',title:'Renal',parent:'folder'}];
const cards=Array.from({length:100},(_,i)=>({id:'card-'+i,deck_id:i<70?'a':'b'}));
const records=Array.from({length:100},(_,i)=>({id:'review-'+i,user_id:user,card_id:'card-'+i,reviewed_at:'2026-10-14T03:30:00Z',rating:'good'}));
test('100 actual events are grouped 70/30 by deck in Cuiaba, without duplicate pages or other users',()=>{
  const result=summarize([...records,records[0],{...records[0],id:'other',user_id:'another-user'}],cards,decks,user);
  assert.equal(result.total,100);assert.equal(result.uniqueCards,100);
  assert.equal(result.days.length,1);assert.equal(result.days[0].date,'2026-10-13');
  assert.deepEqual(result.days[0].distribution.map(x=>[x.path,x.count]),[['Fisiologia / Cardiovascular',70],['Fisiologia / Renal',30]]);
  assert.equal(result.days[0].distribution[0].ratings.good,70);
});
test('repeated reviews count as events while unique cards remain distinct',()=>{
  const result=summarize([records[0],{...records[0],id:'second',rating:'again'}],cards,decks,user);
  assert.equal(result.total,2);assert.equal(result.uniqueCards,1);assert.equal(result.days[0].distribution[0].ratings.again,1);
});
test('midnight boundary follows Cuiaba rather than UTC',()=>{
  const result=summarize([{...records[0],reviewed_at:'2026-10-14T03:59:59Z'},{...records[0],id:'next',reviewed_at:'2026-10-14T04:00:00Z'}],cards,decks,user);
  assert.deepEqual(result.days.map(x=>[x.date,x.count]),[['2026-10-14',1],['2026-10-13',1]]);
});
test('deleted cards remain counted and invalid dates are reported',()=>{
  const result=summarize([records[0],{...records[0],id:'missing',card_id:'deleted'},{...records[0],id:'bad-date',reviewed_at:'invalid'}],cards,decks,user);
  assert.equal(result.total,2);assert.equal(result.unidentified,1);assert.equal(result.invalidDates,1);
  assert.equal(result.days[0].distribution.find(x=>x.deckId===null).path,'Baralho não identificado');
});
test('cyclic folder metadata does not hang and other-account history is never included',()=>{
  const result=summarize([records[0]],cards,[{id:'a',title:'A',parent:'x'},{id:'x',title:'X',parent:'a'}],user);
  assert.equal(result.total,1);assert.equal(result.days[0].distribution[0].path,'X / A');
  assert.equal(summarize(records,cards,decks,'another-user').total,0);
});
