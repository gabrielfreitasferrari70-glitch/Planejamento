/* Manual ChatGPT imports; no generation API, source access, or external authentication. */
'use strict';
(function(){
  let generation=0,busy=false,active='',status='Importe um arquivo de questões para começar.';
  MENU.splice(MENU.findIndex(x=>x[0]==='studies'),0,['questions','exams','Questões']);
  const rows=()=>Array.isArray(data.settings.questionSets)?data.settings.questionSets:[];
  const previousRender=render;
  render=function(){previousRender();if(page==='questions'){$('app').innerHTML=view();$('subtitle').textContent='Questões do seu chat, simulados e resultados no Planejamento.';if(busy)$('questions-import').disabled=true}};
  function redraw(){if(page==='questions')render()}
  const action=(label,name,attrs='')=>btn(label,'questions-'+name,attrs);
  function message(value){status=value;redraw();notify(value)}
  function view(){
    const set=rows().find(s=>s.id===active);
    const history=rows().map(s=>'<li>'+action(esc(s.subject)+' · '+s.questions.length+' questões'+(s.finishedAt?' · '+s.correct+'/'+s.questions.length+' acertos':''),'open','data-id="'+esc(s.id)+'"')+' '+action('Excluir','delete','data-id="'+esc(s.id)+'"')+'</li>').join('');
    return panel('Questões do ChatGPT','<p class="muted">Peça as questões no chat normal do ChatGPT e importe o arquivo aqui. Responda ao simulado e acompanhe seus acertos na sua conta.</p><ol><li>Abra uma conversa no ChatGPT em modo Chat e forneça os materiais.</li><li>Use o pedido abaixo para receber um arquivo JSON com questões e fontes.</li><li>Importe o arquivo neste site e responda ao simulado.</li></ol><div class="pill-row"><a class="btn" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">Abrir ChatGPT ↗</a>'+action('Baixar pedido para ChatGPT','prompt')+'</div><p class="tiny">O site importa e corrige o simulado sem chamar serviços de IA ou iniciar tarefas no Work. A conversa aberta no ChatGPT segue o modo e os limites do seu plano.</p><label class="field-label">Importar questões do ChatGPT<input class="field" type="file" id="questions-import" accept=".json,application/json"></label><p class="tiny">Até 20 questões por arquivo · JSON de até 300 KB. Cada questão precisa de quatro alternativas, gabarito, explicação, nome da fonte e trecho.</p><p class="tiny">As referências são recebidas no arquivo. O site não abre nem confere os documentos originais; confira trechos e páginas antes de usar o gabarito.</p><p class="tiny" role="status" aria-live="polite">'+esc(status)+(busy?' Aguarde…':'')+'</p>')+(set?quiz(set):'')+panel('Meus simulados',history?'<ul>'+history+'</ul>':empty('Seus simulados aparecerão aqui.'));
  }
  function citation(c,s){
    const imported=s.sourceVerification==='imported-unverified'||c.verification==='imported-unverified';
    const url=PlanningQuestionData.safeUrl(c.url)||(c.sourceId&&/^[\w-]{10,160}$/.test(c.sourceId)?'https://drive.google.com/file/d/'+encodeURIComponent(c.sourceId)+'/view':'');
    const location=c.page?'página '+c.page+(c.locationKind==='pdf-export'?' do PDF exportado':''):'trecho';
    return '<details><summary>Fonte: '+esc(c.name)+' · '+esc(location)+(imported?' (informada no arquivo)':'')+'</summary><blockquote>'+esc(c.quote)+'</blockquote>'+(url?'<a class="surface-link" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">Abrir documento ↗</a>':'')+'<p class="tiny">'+(imported?'Referência importada. Confira no material original; o site não verificou esta página ou trecho.':'Referência preservada do simulado anterior. O arquivo original pode ter mudado desde a geração.')+'</p></details>';
  }
  function quiz(s){
    const answers=s.answers||{},finished=Boolean(s.finishedAt);
    return panel(esc(s.subject)+' · '+(finished?s.correct+'/'+s.questions.length+' acertos':'Responder simulado'),s.questions.map((q,i)=>'<fieldset class="panel"><legend>'+(i+1)+'. '+esc(q.stem)+'</legend>'+q.options.map((o,j)=>'<label class="field-label"><span><input type="radio" name="question-'+i+'" data-q-answer="'+i+'" value="'+j+'" '+(answers[i]===j?'checked':'')+' '+(finished?'disabled':'')+'> '+esc(o)+'</span></label>').join('')+(finished?'<p><strong>'+(answers[i]===q.answer?'Acertou':'Errou')+' · Gabarito: '+String.fromCharCode(65+q.answer)+'</strong></p><p>'+esc(q.explanation)+'</p>'+q.citations.map(c=>citation(c,s)).join(''):'')+'</fieldset>').join('')+(finished?'<p>Resultado salvo no Planejamento.</p>'+action('Baixar simulado e resultado','export','data-id="'+esc(s.id)+'"'):action('Concluir e corrigir','finish')));
  }
  async function importFile(file){
    if(busy)return;const owner=window.PlanningAccount?.user?.id,epoch=generation;
    if(!owner){message('Entre na sua conta do Planejamento.');return}
    busy=true;redraw();
    try{
      if(file.size>300000)throw Error('JSON acima de 300 KB.');
      const content=await file.text();
      if(epoch!==generation||PlanningAccount.user?.id!==owner)return;
      let raw;try{raw=JSON.parse(content)}catch{throw Error('Arquivo JSON inválido. Peça ao ChatGPT um arquivo no formato do pedido.')}
      const result=PlanningQuestionData.parse(raw);
      if(rows().length>=20)throw Error('Limite de 20 simulados. Exporte e exclua um antigo antes de importar outro.');
      const signature=JSON.stringify(result.questions);
      if(rows().some(s=>JSON.stringify(s.questions)===signature))throw Error('Este simulado já foi importado. Abra-o no histórico.');
      const set={...result,id:uid(),createdAt:new Date().toISOString(),answers:{}};
      const next=[...rows(),set];
      if(new TextEncoder().encode(JSON.stringify(next)).length>650000||new TextEncoder().encode(JSON.stringify({...data,settings:{...data.settings,questionSets:next}})).length>1350000)throw Error('Histórico cheio. Exporte e exclua simulados antigos.');
      data.settings.questionSets=next;active=set.id;save();message('Simulado importado. As referências precisam ser conferidas no material original.');
    }catch(e){if(epoch===generation&&PlanningAccount.user?.id===owner)message(e.message)}
    finally{if(epoch===generation){busy=false;redraw()}}
  }
  window.addEventListener('planning-account-reset',()=>{generation++;active='';busy=false;status='Importe um arquivo de questões para começar.'});
  document.addEventListener('change',event=>{const el=event.target;
    if(el.id==='questions-import'&&el.files[0])importFile(el.files[0]);
    if(el.dataset.qAnswer!==undefined){const s=rows().find(s=>s.id===active);if(s&&!s.finishedAt){s.answers={...s.answers,[el.dataset.qAnswer]:Number(el.value)};save()}}
  });
  document.addEventListener('click',event=>{const b=event.target.closest('[data-action^="questions-"]');if(!b)return;const a=b.dataset.action.slice(10);
    if(a==='prompt'){downloadFile(PlanningQuestionData.prompt,'pedido-chatgpt.txt','text/plain;charset=utf-8');return}
    if(a==='open'){active=b.dataset.id;redraw();return}
    if(a==='delete'){if(confirm('Excluir este simulado e suas respostas do Planejamento? Exporte antes se quiser guardar uma cópia.')){data.settings.questionSets=rows().filter(s=>s.id!==b.dataset.id);if(active===b.dataset.id)active='';save();redraw()}return}
    if(a==='export'){const s=rows().find(s=>s.id===b.dataset.id);if(s)downloadFile(JSON.stringify({format:'planejamento-question-set-v1',set:s},null,2),'simulado-planejamento.json','application/json');return}
    if(a==='finish'){const s=rows().find(s=>s.id===active);if(!s||s.finishedAt)return;if(s.questions.some((q,i)=>!Number.isInteger(s.answers?.[i]))){notify('Responda todas as questões antes de corrigir.');return}s.correct=s.questions.filter((q,i)=>s.answers[i]===q.answer).length;s.finishedAt=new Date().toISOString();save();redraw()}
  });
  render();
})();
