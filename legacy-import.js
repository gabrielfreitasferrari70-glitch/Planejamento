/* Importador unilateral e local para a exportação do planejamento original.
   Nunca acessa a fonte, banco, login ou API do MedReview. */
'use strict';
(function(){
function localDay(x){if(!x)return '';let s=String(x);if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s;let d=new Date(s);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Cuiaba',year:'numeric',month:'2-digit',day:'2-digit'}).format(d):''}
function localTime(x){if(!x)return '';let d=new Date(x);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('en-GB',{timeZone:'America/Cuiaba',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d):''}
function clean(s){return String(s==null?'':s).slice(0,4000)}
async function importLegacy(file){
  if(!file)return;
  if(file.size>2000000){notify('Arquivo superior a 2 MB.');return}
  try{
    let src=JSON.parse(await file.text());
    if(src.format!=='medreview-planning-v1'||!Array.isArray(src.records)||src.records.length>10000)throw Error('Formato não reconhecido ou quantidade excessiva');
    let out={sessions:[],events:[],tasks:[],materials:[],reviews:[]};
    for(let r of src.records){
      if(!r||!r.data||typeof r.data!=='object')continue;
      let d=r.data,id='old-'+clean(r.id||uid()),date;
      if(r.kind==='session'){
        date=localDay(d.studied_at);if(!date||!d.subject||!d.topic)continue;
        out.sessions.push({id:'legacy-session-'+id,date,subject:clean(d.subject),topic:clean(d.topic),minutes:d.duration_minutes===undefined?'':clean(d.duration_minutes),questions:d.questions===undefined?'':clean(d.questions),correct:d.correct===undefined?'':clean(d.correct)});
      }else if(r.kind==='event'){
        date=localDay(d.starts_at);if(!date||!d.title)continue;
        out.events.push({id:'legacy-event-'+id,date,from:localTime(d.starts_at),to:localTime(d.ends_at),title:clean(d.title),subject:clean(d.subject||'UC2'),type:d.event_type==='exam'?'exam':d.event_type==='study'?'study':'class',attendance:clean(d.attendance||''),origin:'legacy'});
      }else if(r.kind==='task'){
        if(!d.topic)continue;
        let start=localTime(d.scheduled_at),duration=Number(d.estimated_minutes||0);
        out.tasks.push({id:'legacy-task-'+id,title:clean(d.topic),subject:clean(d.subject||''),date:clean(d.deadline||''),estimate:d.estimated_minutes===undefined?'':clean(d.estimated_minutes),priority:String(Math.max(1,Math.min(3,Number(d.priority)||1))),scheduled:localDay(d.scheduled_at),start,end:start&&duration?time((mins(start)+duration)%1440):'',done:d.status==='done'});
      }else if(r.kind==='material'){
        out.materials.push({id:'legacy-material-'+id,title:clean(d.title||'Material'),subject:clean(d.subject||''),url:typeof d.url==='string'&&/^https:\/\//i.test(d.url)?clean(d.url):''});
      }
    }
    if(Array.isArray(src.reviews))for(let r of src.reviews){let d=r?.data||{},due=clean(d.due_on||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(due)||!d.topic)continue;out.reviews.push({id:'legacy-review-'+clean(r.id||uid()),topic:clean(d.topic),subject:clean(d.subject||''),due,interval:d.interval_days||'',done:d.status==='done'||Boolean(d.completed_at)})}
    let addition={};for(let [k,items] of Object.entries(out)){let existing=new Set(data[k].map(x=>x.id));addition[k]=items.filter(x=>!existing.has(x.id))}
    let count=Object.values(addition).reduce((sum,a)=>sum+a.length,0);
    if(!count){notify('Nenhum novo registro foi encontrado.');return}
    let preview=Object.entries(addition).map(([k,a])=>k+': '+a.length).join('\n');
    if(!confirm('IMPORTAÇÃO LOCAL — PRÉVIA\n\n'+preview+'\n\nAdicionar '+count+' registros somente nesta cópia? Nenhum dado original será alterado.'))return;
    for(let [k,items] of Object.entries(addition))data[k].push(...items);
    let settings=src.records.find(r=>r.kind==='settings')?.data;
    if(settings&&confirm('Também importar ajustes do planejamento antigo (intervalos e janelas de disponibilidade) somente para esta cópia?')){
      if(Array.isArray(settings.review_days))data.settings.intervals=settings.review_days.filter(n=>Number.isInteger(n)&&n>0&&n<=1000).join(',');
      if(Array.isArray(settings.availability)){let availability={};for(let x of settings.availability){if(Number.isInteger(x.weekday)&&x.weekday>=0&&x.weekday<=6&&/^\d\d:\d\d$/.test(x.start||'')&&/^\d\d:\d\d$/.test(x.end||'')&&x.start<x.end&&!availability[x.weekday])availability[x.weekday]={from:x.start,to:x.end}}data.settings.availability=availability}
    }
    save();render();notify(count+' registros foram incorporados à cópia local.');
  }catch(e){notify('Não foi possível importar: '+e.message)}
}
document.addEventListener('change',e=>{if(e.target.id==='legacy-upload')importLegacy(e.target.files?.[0])});
})();