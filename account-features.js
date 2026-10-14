/* Account adapter for the existing Antigravity features; no UI is replaced. */
'use strict';
(function(){
  const clone=value=>JSON.parse(JSON.stringify(value));
  const user=()=>window.PlanningAccount?.user;
  const owner=()=>Boolean(user()?.id&&user().id===window.PLANNING_CONFIG?.legacyOwnerId);
  const legacyTracker='planejamento-evaluated-classes',legacyWhatsApp='planejamento-whatsapp-adm-config';
  const credentialKey=()=>user()?.id?'planejamento-whatsapp-key:'+user().id:null;
  function local(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
  function migrate(){
    if(!owner())return;
    let changed=false;
    if(!data.settings.evaluatedClassesLegacyImported){
      const rows=local(legacyTracker,[]),current=Array.isArray(data.settings.evaluatedClasses)?data.settings.evaluatedClasses:[];
      if(Array.isArray(rows))for(const row of rows){
        if(!row||typeof row.id!=='string'||!row.id||current.some(item=>item.id===row.id))continue;
        current.push(clone(row));changed=true;
      }
      data.settings.evaluatedClasses=current;data.settings.evaluatedClassesLegacyImported=true;changed=true;
    }
    if(!data.settings.whatsappLegacyImported){
      const settings=local(legacyWhatsApp,{});
      if(settings&&typeof settings==='object'){
        if(settings.phone&&!data.settings.whatsappPhone)data.settings.whatsappPhone=String(settings.phone);
        if(settings.apiKey&&credentialKey()){try{if(!localStorage.getItem(credentialKey()))localStorage.setItem(credentialKey(),String(settings.apiKey))}catch{}}
      }
      data.settings.whatsappLegacyImported=true;changed=true;
    }
    // The old storage is retained as a recovery copy, and is never read by another account.
    if(changed)save();
  }
  window.AccountFeatureData={
    isOwner:owner,
    trackedClasses(){if(!user())return [];migrate();return clone(data.settings.evaluatedClasses||[])},
    saveTrackedClasses(rows){if(!user())return false;data.settings.evaluatedClasses=clone(rows);return true},
    reviewTab(){return user()?data.settings.reviewTab||'flashcards':'flashcards'},
    setReviewTab(tab){if(!user()||!['flashcards','aulas','dominadas'].includes(tab))return;data.settings.reviewTab=tab;save()},
    whatsapp(){
      if(!owner())return {phone:'',apiKey:'',autoDaily:false,lastSentDate:''};migrate();let key='';
      try{key=localStorage.getItem(credentialKey())||''}catch{}
      return {phone:data.settings.whatsappPhone||'',apiKey:key,autoDaily:Boolean(data.settings.whatsappAutoDaily),lastSentDate:data.settings.whatsappLastSentDate||''};
    },
    saveWhatsApp(settings){
      if(!owner())return false;
      if(settings.phone!==undefined)data.settings.whatsappPhone=String(settings.phone);
      if(settings.apiKey!==undefined){try{localStorage.setItem(credentialKey(),String(settings.apiKey))}catch{notify('Não foi possível guardar a chave neste dispositivo.');return false}}
      if(settings.autoDaily!==undefined)data.settings.whatsappAutoDaily=Boolean(settings.autoDaily);
      if(settings.lastSentDate!==undefined)data.settings.whatsappLastSentDate=String(settings.lastSentDate);
      save();return true;
    }
  };
})();
