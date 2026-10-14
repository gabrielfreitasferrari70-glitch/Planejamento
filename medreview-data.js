/* Read-only summaries of MedReview review events. No card content is copied. */
'use strict';
(function(root){
  function summarize(reviews,cards,decks,userId){
    const cardMap=new Map(cards.map(x=>[x.id,x])),deckMap=new Map(decks.map(x=>[x.id,x]));
    const days=new Map(),seen=new Set(),allCards=new Set();
    let invalidDates=0,unidentified=0;
    const dateFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'});
    function deckPath(id){
      const parts=[],visited=new Set();
      while(id&&!visited.has(id)){
        visited.add(id);const deck=deckMap.get(id);if(!deck)break;
        parts.unshift(String(deck.title||'Baralho sem título'));id=deck.parent;
      }
      return parts.length?parts.join(' / '):'Baralho não identificado';
    }
    for(const review of reviews){
      if(!review||review.user_id!==userId||!review.id||seen.has(review.id))continue;
      seen.add(review.id);
      const raw=review.reviewed_at||review.created_at;
      if(typeof raw!=='string'||!/(Z|[+-]\d{2}:?\d{2})$/.test(raw)||!Number.isFinite(Date.parse(raw))){invalidDates++;continue}
      const date=dateFormat.format(new Date(raw));
      if(!days.has(date))days.set(date,{date,count:0,cards:new Set(),groups:new Map()});
      const day=days.get(date),cardId=review.card_id||review.card_ref||null,card=cardMap.get(cardId);
      const deckId=card?.deck_id||null,identified=Boolean(deckId&&deckMap.has(deckId));
      const key=identified?deckId:'unidentified';
      if(!identified)unidentified++;
      if(!day.groups.has(key))day.groups.set(key,{deckId:identified?deckId:null,path:identified?deckPath(deckId):'Baralho não identificado',count:0,cards:new Set(),ratings:{again:0,hard:0,good:0,easy:0}});
      const group=day.groups.get(key);day.count++;group.count++;
      if(cardId){day.cards.add(cardId);group.cards.add(cardId);allCards.add(cardId)}
      if(Object.hasOwn(group.ratings,review.rating))group.ratings[review.rating]++;
    }
    const result=[...days.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(day=>({
      date:day.date,count:day.count,uniqueCards:day.cards.size,
      distribution:[...day.groups.values()].sort((a,b)=>b.count-a.count||a.path.localeCompare(b.path)).map(group=>({
        deckId:group.deckId,path:group.path,count:group.count,uniqueCards:group.cards.size,ratings:group.ratings
      }))
    }));
    return {total:result.reduce((n,d)=>n+d.count,0),uniqueCards:allCards.size,days:result,invalidDates,unidentified};
  }
  root.MedReviewData={summarize};
  if(typeof module!=='undefined')module.exports=root.MedReviewData;
})(globalThis);
