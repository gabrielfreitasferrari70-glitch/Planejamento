/* Per-account lesson tasks. The ledger survives deletion so removed tasks stay removed. */
(function(root){
  'use strict';
  const plain=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const lesson=event=>['class','tutorial','community'].includes(event.type);
  const enabled=data=>data.settings?.classTaskPolicy?.enabled===true;
  function priorityFor(event){
    const subject=plain(event.subject);
    return /^(anatomia|fisiologia)(\b|$)/.test(subject)||(!subject||subject==='uc2')&&/^(aula de )?(anatomia|fisiologia)\b/.test(plain(event.title))?'3':'1';
  }
  const topic=title=>plain(title).replace(/^(estudar:|aprender\s*\/\s*aprofundar:|repor aula nao assistida:)\s*/, '');
  const key=event=>'event:'+event.id;
  const currentDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function sync(data,asOf=currentDay()){
    if(!enabled(data))return false;
    const policy=data.settings.classTaskPolicy;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(policy.fromDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(asOf||''))return false;
    const ledger=data.settings.classTaskLedger||(data.settings.classTaskLedger={});
    let changed=false;
    const events=[...(data.replacement||[]),...(data.events||[])];
    // Undo the earlier bulk generation, preserving manual tasks and any user edits/work.
    for(const event of events.filter(e=>e.date>asOf)){
      const id=ledger[key(event)],task=data.tasks.find(t=>t.id===id);
      if(!task||task.id!=='class-task:'+event.id||task.origin!=='class'||task.done)continue;
      const original={id:task.id,title:'Estudar: '+event.title,subject:event.subject||'UC2',date:event.date,priority:priorityFor(event),estimate:60,done:false,origin:'class',classSourceId:event.id,classDate:event.date};
      if(Object.keys(task).length!==Object.keys(original).length||Object.keys(original).some(k=>task[k]!==original[k]))continue;
      data.tasks=data.tasks.filter(t=>t.id!==id);
      delete ledger[key(event)];changed=true;
    }
    const bound=new Set(Object.values(ledger));
    for(const event of events){
      if(!event.id||!lesson(event)||!/^\d{4}-\d{2}-\d{2}$/.test(event.date||''))continue;
      if(event.date>asOf)continue;
      if(event.date<policy.fromDate&&!(policy.extraEventIds||[]).includes(event.id))continue;
      if(Object.hasOwn(ledger,key(event)))continue;
      let task=data.tasks.find(t=>t.classSourceId===event.id)||data.tasks.find(t=>{
        if(bound.has(t.id)||t.classSourceId||topic(t.title)!==topic(event.title)||plain(t.subject)!==plain(event.subject))return false;
        const days=(Date.parse(t.date+'T12:00:00Z')-Date.parse(event.date+'T12:00:00Z'))/86400000;
        return days>=0&&days<=3;
      });
      if(!task){
        task={id:'class-task:'+event.id,title:'Estudar: '+event.title,subject:event.subject||'UC2',date:event.date,priority:priorityFor(event),estimate:60,done:false,origin:'class'};
        data.tasks.push(task);
      }else if(!task.done){task.priority=priorityFor(event)}
      task.classSourceId=event.id;
      task.classDate=event.date;
      ledger[key(event)]=task.id;bound.add(task.id);changed=true;
    }
    return changed;
  }
  function followup(data,event,fields,asOf=currentDay()){
    // The day-closing flow reuses the lesson's task, including across devices.
    if(!enabled(data)||!lesson(event))return null;
    sync(data,asOf);
    const id=data.settings.classTaskLedger?.[key(event)];
    if(!id)return null;
    const task=data.tasks.find(t=>t.id===id);
    if(task&&!task.done)Object.assign(task,fields,{priority:priorityFor(event)});
    return {handled:true}; // A deleted/completed task is deliberately left alone.
  }
  const api={sync,enabled,priorityFor,followup};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PlanningClassTasks=api;
})(typeof globalThis!=='undefined'?globalThis:this);
