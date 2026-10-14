/* Authenticated, read-only MedReview integration. Tokens stay out of app backups. */
'use strict';
(function(){
  const config=window.MEDREVIEW_CONFIG;
  const state={user:null,summary:null,status:'disconnected',message:'',syncedAt:null,period:'30',syncing:false};
  let client=null,channel=null,generation=0,inFlight=null,refreshTimer=null;
  const originalReviewView=reviewView;
  const PAGE_SIZE=500,MAX_RECORDS=100000;
  function update(){if(['reviews','dashboard','today','studies','reports'].includes(page))render()}
  function fail(message){state.status='error';state.message=message;update()}
  function formatDay(date){return fmt(date,{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})}
  function overview(){
    const connected=Boolean(state.user),summary=state.summary;
    const status=state.status==='loading'?'Atualizando histórico...':state.status==='error'?state.message:connected?(state.syncedAt?'Atualizado em '+new Date(state.syncedAt).toLocaleString('pt-BR',{timeZone:ZONE}):'Conta conectada. Carregando histórico...'):'Conecte sua conta do MedReview para consultar suas revisões reais.';
    const actions=connected?btn('Atualizar agora','medreview-sync')+btn('Desconectar','medreview-disconnect'):btn('Conectar MedReview','medreview-connect','','btn btn-primary');
    const ranges=[['7','Últimos 7 dias'],['30','Últimos 30 dias'],['90','Últimos 90 dias'],['365','Último ano'],['all','Todo o histórico']];
    const identity=connected?'<p class="tiny">Conta conectada: '+esc(state.user.email||'Gabriel')+'</p>':'';
    const todayCount=summary?.days.find(d=>d.date===today())?.count||0;
    const stats='<div class="stats medreview-stats"><div class="stat"><div class="stat-top">Revisões de flashcards hoje</div><div class="stat-main">'+(summary?todayCount:'—')+'</div><div class="stat-hint">Fuso de Cuiabá</div></div><div class="stat"><div class="stat-top">Revisões no período</div><div class="stat-main">'+(summary?summary.total:'—')+'</div><div class="stat-hint">Cada resposta registrada conta uma vez</div></div><div class="stat"><div class="stat-top">Cartões distintos</div><div class="stat-main">'+(summary?summary.uniqueCards:'—')+'</div><div class="stat-hint">No período selecionado</div></div></div>';
    const selector='<label class="field-label medreview-period" for="medreview-period">Período<select id="medreview-period" class="field">'+ranges.map(([value,label])=>'<option value="'+value+'" '+(state.period===value?'selected':'')+'>'+label+'</option>').join('')+'</select></label>';
    const days=summary?.days||[];
    const list=days.length?days.map(day=>'<button class="medreview-day" type="button" data-action="medreview-day" data-date="'+day.date+'"><span><strong>'+formatDay(day.date)+'</strong><small>'+day.uniqueCards+' cartões distintos · '+day.distribution.length+' origens</small></span><span class="medreview-count">'+day.count+'<small>revisões ↗</small></span></button>').join(''):empty(summary?'Nenhuma revisão registrada nesse período.':connected?'O histórico aparecerá após a leitura do MedReview.':'O histórico ficará disponível depois de conectar sua conta.');
    const notes=summary&&(summary.invalidDates||summary.unidentified)?'<p class="tiny">'+(summary.unidentified?summary.unidentified+' revisões sem baralho identificável. ':'')+(summary.invalidDates?summary.invalidDates+' registros sem data válida não foram contabilizados.':'')+'</p>':'';
    const lastRead=summary&&state.syncedAt?'<p class="tiny">Última leitura concluída: '+new Date(state.syncedAt).toLocaleString('pt-BR',{timeZone:ZONE})+'</p>':'';
    return panel('Flashcards · MedReview','<p class="muted">Suas revisões realizadas no MedReview, agrupadas por dia. Clique no total diário para ver a distribuição por baralho.</p><div class="pill-row">'+actions+'<a href="'+esc(config?.site||'https://flashcard-lac-xi.vercel.app')+'" target="_blank" rel="noopener noreferrer" class="surface-link">Abrir MedReview ↗</a></div>'+identity+'<p class="tiny" role="status">'+esc(status)+'</p>'+lastRead)+stats+panel('Histórico diário',selector+list+notes);
  }
  reviewView=function(){return overview()+'<details class="local-review-details"><summary>Revisões de estudo planejadas neste site</summary>'+originalReviewView()+'</details>'};
  function showDay(date){
    const day=state.summary?.days.find(x=>x.date===date);if(!day)return;
    const ratings={again:'Novamente',hard:'Difícil',good:'Bom',easy:'Fácil'};
    const rows=day.distribution.map(group=>'<section class="medreview-distribution"><h3>'+esc(group.path)+'</h3><div class="pill-row">'+tag(group.count+' revisões')+tag(group.uniqueCards+' cartões distintos','gray')+tag(Math.round(group.count/day.count*100)+'% do dia','gray')+'</div><p class="tiny">'+Object.entries(group.ratings).map(([key,count])=>ratings[key]+': '+count).join(' · ')+'</p></section>').join('');
    $('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="medreview-detail-title"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><h2 id="medreview-detail-title">Flashcards · '+formatDay(day.date)+'</h2><p>'+day.count+' revisões · '+day.uniqueCards+' cartões distintos</p>'+rows+'<p class="tiny">Distribuição pelo baralho atual do cartão. Cartões removidos ou sem acesso aparecem como baralho não identificado. São contabilizadas apenas revisões da sua conta registradas pelo MedReview.</p></div>';
    $('modal').classList.remove('hidden');
  }
  function showAuth(){
    $('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="medreview-auth-title"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><h2 id="medreview-auth-title">Conectar sua conta do MedReview</h2><p>Entre com a mesma conta administradora do MedReview. A autenticação é feita diretamente no serviço usado pelo MedReview; sua senha não é guardada neste site.</p><form id="medreview-auth-form"><label class="field-label">E-mail<input class="field" name="email" type="email" autocomplete="username" required></label><label class="field-label">Senha<input class="field" name="password" type="password" autocomplete="current-password" required></label><p class="tiny" id="medreview-auth-status" role="status"></p><button type="submit" class="btn btn-primary">Conectar conta</button></form></div>';
    $('modal').classList.remove('hidden');$('medreview-auth-form').elements.email.focus();
  }
  async function authenticate(event){
    event.preventDefault();const form=event.target,status=$('medreview-auth-status'),button=form.querySelector('button[type="submit"]');
    button.disabled=true;status.textContent='Autenticando no MedReview...';
    const email=form.elements.email.value.trim(),password=form.elements.password.value;
    try{
      if(!client)throw Error('Não foi possível carregar a conexão. Atualize a página e tente novamente.');
      const {data:auth,error}=await client.auth.signInWithPassword({email,password});
      form.elements.password.value='';
      if(error)throw Error('Não foi possível entrar. Confira o e-mail e a senha da sua conta MedReview.');
      await acceptSession(auth.session);
      if(!state.user)throw Error(state.message||'Esta integração está vinculada à conta administradora de Gabriel.');
      closeModal();update();
    }catch(error){form.elements.password.value='';status.textContent=error.message}
    finally{button.disabled=false}
  }
  async function readPages(table,columns,modify){
    let items=[];
    for(let offset=0;offset<MAX_RECORDS;offset+=PAGE_SIZE){
      let query=client.from(table).select(columns).order('id',{ascending:true}).range(offset,offset+PAGE_SIZE-1);
      if(modify)query=modify(query);
      const {data:rows,error}=await query;
      if(error)throw Error('O MedReview não liberou a leitura de '+table+'. Verifique sua conexão e permissões da conta.');
      items.push(...(rows||[]));if(!rows||rows.length<PAGE_SIZE)return items;
    }
    throw Error('O histórico excede o limite de leitura. Selecione um período menor.');
  }
  async function sync(){
    if(!state.user||!client)return;
    if(inFlight)return inFlight;
    const currentGeneration=generation,userId=state.user.id,period=state.period;
    state.syncing=true;state.status='loading';state.message='';update();
    const task=(async()=>{
      try{
        const snapshot=new Date().toISOString();
        const start=period==='all'?null:dayAdd(today(),1-Number(period))+'T04:00:00Z';
        const reviews=await readPages('mr_reviews','id,user_id,card_id,reviewed_at,rating',query=>{
          query=query.eq('user_id',userId).lte('reviewed_at',snapshot);
          return start?query.gte('reviewed_at',start):query;
        });
        const ids=[...new Set(reviews.filter(x=>x.user_id===userId).map(x=>x.card_id).filter(Boolean))];
        const cards=[];
        for(let i=0;i<ids.length;i+=100){
          const chunk=ids.slice(i,i+100);
          cards.push(...await readPages('mr_cards','id,deck_id',query=>query.in('id',chunk)));
        }
        const decks=[],visited=new Set();
        let needed=[...new Set(cards.map(card=>card.deck_id).filter(Boolean))];
        while(needed.length){
          const batch=needed.filter(id=>!visited.has(id));if(!batch.length)break;
          batch.forEach(id=>visited.add(id));const loaded=[];
          for(let i=0;i<batch.length;i+=100)loaded.push(...await readPages('mr_decks','id,title,parent',query=>query.in('id',batch.slice(i,i+100))));
          decks.push(...loaded);needed=[...new Set(loaded.map(deck=>deck.parent).filter(id=>id&&!visited.has(id)))];
        }
        if(currentGeneration!==generation||state.user?.id!==userId||state.period!==period)return;
        state.summary=MedReviewData.summarize(reviews,cards,decks,userId);
        state.syncedAt=new Date().toISOString();state.status='connected';
      }catch(error){if(currentGeneration===generation){state.status='error';state.message=error.message}}
      finally{if(currentGeneration===generation){state.syncing=false;update()}}
    })();
    inFlight=task;await task;if(inFlight===task)inFlight=null;
  }
  function clearSession(){
    generation++;state.user=null;state.summary=null;state.syncedAt=null;state.status='disconnected';state.message='';state.syncing=false;inFlight=null;
    if(channel&&client)client.removeChannel(channel);channel=null;
    if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=null;update();
  }
  async function acceptSession(session){
    if(!session){clearSession();return}
    const validationGeneration=generation;
    const {data:identity,error}=await client.auth.getUser(session.access_token);
    if(validationGeneration!==generation)return;
    if(error||!identity.user){clearSession();fail('A sessão do MedReview expirou. Conecte sua conta novamente.');return}
    if(identity.user.id!==config.expectedUserId){
      clearSession();await client.auth.signOut({scope:'local'});fail('Conecte a conta administradora de Gabriel usada no MedReview.');return;
    }
    if(state.user?.id!==identity.user.id){clearSession();state.user=identity.user}
    if(!channel){
      channel=client.channel('planning-medreview-own-reviews').on('postgres_changes',{event:'*',schema:'public',table:'mr_reviews',filter:'user_id=eq.'+identity.user.id},()=>{
        if(refreshTimer)clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>sync(),1500);
      }).subscribe();
    }
    await sync();
  }
  document.addEventListener('submit',event=>{if(event.target.id==='medreview-auth-form')authenticate(event)});
  document.addEventListener('change',event=>{
    if(event.target.id==='medreview-period'){
      generation++;state.period=event.target.value;state.summary=null;state.syncedAt=null;inFlight=null;sync();update();
    }
  });
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button)return;
    switch(button.dataset.action){
      case'medreview-connect':showAuth();break;
      case'medreview-sync':sync();break;
      case'medreview-day':showDay(button.dataset.date);break;
      case'medreview-disconnect':clearSession();client?.auth.signOut({scope:'local'});break;
    }
  });
  window.addEventListener('focus',()=>{if(state.user)sync()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.user)sync()});
  setInterval(()=>{if(state.user&&document.visibilityState==='visible')sync()},60000);
  async function initialize(){
    try{
      if(!config||!window.supabase?.createClient)throw Error('A conexão MedReview não está disponível nesta edição.');
      client=window.supabase.createClient(config.url,config.publishableKey,{auth:{storageKey:'planejamento-medreview-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
      client.auth.onAuthStateChange((event,session)=>{
        if(event==='SIGNED_OUT')clearSession();
        else if(event==='SIGNED_IN'||event==='TOKEN_REFRESHED')setTimeout(()=>acceptSession(session),0);
      });
      const {data:auth}=await client.auth.getSession();if(auth.session)await acceptSession(auth.session);
    }catch(error){fail(error.message)}
  }
  window.MedReviewConnection={get status(){return state.status},get summary(){return state.summary},sync};
  initialize();render();
})();
