/* Each upload is previewed and saved only to the verified current account. */
'use strict';
(function(){
  let preview=null;
  async function upload(file,input){
    if(!file)return;
    const output=$('semester-import-status');
    if(!navigator.onLine){output.textContent='Conecte-se à internet para analisar sua planilha.';return}
    if(file.size>3000000){output.textContent='Envie um arquivo de até 3 MB.';return}
    if(!/\.(pdf|xlsx|csv)$/i.test(file.name)){output.textContent='Use um arquivo PDF, XLSX ou CSV.';return}
    input.disabled=true;output.textContent='Analisando datas, horários e atividades da sua planilha...';
    try{
      const result=await PlanningAccount.analyzeSchedule(file);
      if(!Array.isArray(result.events)||!result.events.length||result.events.some(x=>!x.id||!/^\d{4}-\d{2}-\d{2}$/.test(x.date||'')||!x.title))throw Error('O cronograma recebido está incompleto. Tente outra versão da planilha.');
      preview=result;
      const source=result.source||{},counts=source.counts||{};
      $('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-title"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><span class="mr-eyebrow">Confira antes de importar</span><h2 id="import-title">Seu semestre organizado</h2><p>'+esc(source.filename||file.name)+'</p><div class="pill-row">'+tag(result.events.length+' atividades')+tag((counts.exam||0)+' avaliações')+'</div><p class="tiny">'+esc(fmt(source.start))+' a '+esc(fmt(source.end))+'. As aulas e atividades aparecerão na Semana e no Cronograma; as avaliações também aparecerão em Provas.</p><h3>Prévia das primeiras atividades</h3>'+result.events.slice(0,6).map(x=>eventHTML(x,true)).join('')+'<p class="tiny">'+(result.events.length>6?'Mais '+(result.events.length-6)+' atividades no cronograma. ':'')+'Ao salvar, este cronograma substitui o anterior somente na sua conta. Tarefas, estudos e anotações são preservados. Nenhuma revisão é marcada como realizada.</p><div class="pill-row">'+btn('Cancelar','close')+btn('Salvar meu cronograma','semester-import-confirm','','btn btn-primary')+'</div></div>';
      $('modal').classList.remove('hidden');output.textContent='Prévia pronta. Confira as atividades antes de salvar.';
    }catch(error){output.textContent=error.message;preview=null}
    finally{input.disabled=false;input.value='';input.blur()}
  }
  document.addEventListener('change',event=>{if(event.target.id==='semester-upload')upload(event.target.files[0],event.target)});
  document.addEventListener('click',event=>{
    const action=event.target.closest('[data-action]')?.dataset.action;
    if(action==='close')preview=null;
    if(action==='semester-import-template')downloadFile(csvRows([['data','inicio','fim','atividade','disciplina','professor'],[today(),'08:00','10:00','Aula de exemplo','Disciplina','Prof. Nome']]),'modelo-cronograma.csv','text/csv;charset=utf-8');
    if(action==='semester-import-confirm'){
      if(!preview||PlanningAccount.user?.id!==preview.owner){preview=null;closeModal();notify('A conta mudou. Importe a planilha novamente.');return}
      data.replacement=preview.events;data.settings.academicSource=preview.source;preview=null;closeModal();save();render();notify('Seu cronograma foi salvo. A sincronização acompanha sua conta.');
    }
    if(action==='materials-link-save'){
      const value=$('materials-url').value.trim();
      if(value&&!/^https:\/\/drive\.google\.com\//i.test(value)){notify('Use um link da sua pasta em https://drive.google.com/.');return}
      data.settings.materialsUrl=value;save();render();notify(value?'Link dos materiais salvo na sua conta.':'Link dos materiais removido.');
    }
  });
})();
