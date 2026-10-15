/* Three-way merge for one user's planning data. No authentication material. */
(function(root){
  'use strict';
  const arrays=['tasks','sessions','reviews','materials','events','notes','replacement','mistakes'];
  const objects=['settings','examScopes','integration'];
  const dangerous=new Set(['__proto__','constructor','prototype']);
  const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function validate(value){if(Array.isArray(value))value.forEach(validate);else if(object(value))for(const key of Object.keys(value)){if(dangerous.has(key))throw Error('Campo de dados inválido.');validate(value[key])}}
  function stable(value){if(value===undefined)return 'undefined';if(Array.isArray(value))return '['+value.map(stable).join(',')+']';if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';return JSON.stringify(value)}
  const equal=(a,b)=>stable(a)===stable(b);
  function snapshot(source){
    if(!object(source))throw Error('Os registros não têm um formato válido.');validate(source);
    const result={};for(const key of arrays){if(source[key]!==undefined&&!Array.isArray(source[key]))throw Error('Lista inválida: '+key);result[key]=clone(source[key]||[]);index(result[key],key)}
    const settings=source.settings||{};
    if(!object(settings))throw Error('Configurações inválidas.');
    result.settings={availability:clone(settings.availability||{}),goal:settings.goal??12,intervals:settings.intervals??'',theme:settings.theme||'light'};
    if(settings.academicSource!==undefined){if(!object(settings.academicSource))throw Error('Fonte acadêmica inválida.');result.settings.academicSource=clone(settings.academicSource)}
    if(settings.materialsUrl!==undefined)result.settings.materialsUrl=String(settings.materialsUrl);
    for(const key of ['whatsappPhone','whatsappAutoDaily','whatsappLastSentDate','whatsappLegacyImported','ligaAnatomia','evaluatedClassesLegacyImported','reviewTab','focusBreak','focusSound','reviewsPerDay'])if(settings[key]!==undefined)result.settings[key]=clone(settings[key]);
    if(settings.evaluatedClasses!==undefined){if(!Array.isArray(settings.evaluatedClasses))throw Error('Avaliações de aulas inválidas.');result.settings.evaluatedClasses=clone(settings.evaluatedClasses);index(result.settings.evaluatedClasses,'evaluatedClasses')}
    result.examScopes=clone(source.examScopes||{});if(!object(result.examScopes))throw Error('Conteúdos de provas inválidos.');
    result.integration={};for(const key of ['clientId','lastSync','driveRestoredAt','sheetUrl','sheetRange'])if(source.integration?.[key]!==undefined)result.integration[key]=clone(source.integration[key]);
    return result;
  }
  function index(rows,kind){const out=new Map();for(const row of rows){if(!object(row))throw Error('Registro inválido: '+kind);const key=kind==='notes'?row.date:row.id;if(typeof key!=='string'||!key||out.has(key))throw Error('Identificador inválido ou duplicado: '+kind);out.set(key,row)}return out}
  function merge(base,local,remote,prefer){
    base=snapshot(base);local=snapshot(local);remote=snapshot(remote);const conflicts=[];
    function field(b,l,r,path){
      if(equal(l,r))return clone(l);if(equal(l,b))return clone(r);if(equal(r,b))return clone(l);
      if(path.join('.')==='settings.evaluatedClasses'&&Array.isArray(l)&&Array.isArray(r)){const bm=index(b||[],'evaluatedClasses'),lm=index(l,'evaluatedClasses'),rm=index(r,'evaluatedClasses'),out=[];for(const id of new Set([...rm.keys(),...lm.keys(),...bm.keys()])){const record=field(bm.get(id),lm.get(id),rm.get(id),path.concat(id));if(record!==undefined)out.push(record)}return out}
      if(object(l)&&object(r)&&(object(b)||b===undefined)){const out={};for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){const value=field(b?.[key],l[key],r[key],path.concat(key));if(value!==undefined)out[key]=value}return out}
      conflicts.push({path:path.join(' / '),local:clone(l),remote:clone(r)});return clone(prefer==='remote'?r:l);
    }
    const payload={};for(const key of arrays){if(key==='replacement'){payload[key]=field(base[key],local[key],remote[key],[key]);continue}const b=index(base[key],key),l=index(local[key],key),r=index(remote[key],key);payload[key]=[];for(const id of new Set([...r.keys(),...l.keys(),...b.keys()])){const record=field(b.get(id),l.get(id),r.get(id),[key,id]);if(record!==undefined)payload[key].push(record)}}
    for(const key of objects)payload[key]=field(base[key],local[key],remote[key],[key]);
    return {payload:snapshot(payload),conflicts};
  }
  const api={snapshot,merge,equal,empty:()=>snapshot({})};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PlanningCloudData=api;
})(typeof globalThis!=='undefined'?globalThis:this);
