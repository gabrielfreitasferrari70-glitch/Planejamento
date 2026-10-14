/* Authenticated cross-device planning. Account drafts and credentials are separate. */
'use strict';
(function(){
  const config=window.PLANNING_CONFIG,enabled=Boolean(config?.url&&config?.publishableKey);
  if(!enabled){window.PlanningAccount={enabled:false};document.body.classList.remove('account-boot');return}
  const model=PlanningCloudData,originalLegacy=JSON.parse(JSON.stringify(data)),prefix='planejamento-account-v1:'+new URL(config.url).hostname+':';
  let legacy=model.empty(),legacyError='';try{legacy=model.snapshot(data)}catch(error){legacyError=error.message}
  data=model.empty();
  const client=window.supabase.createClient(config.url,config.publishableKey,{auth:{storageKey:prefix+'auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const state={user:null,pendingUser:null,accessToken:null,base:model.empty(),revision:0,status:'loading',message:'Verificando sua conta...',syncedAt:null,migrated:false,conflicts:null};
  let generation=0,flight=null,timer=null,channel=null,formDirty=false,queuedRemote=false,migrationConflict=false;
  const previousRender=render,previousGoto=goto;
  const count=payload=>['tasks','sessions','reviews','materials','events','notes','mistakes','replacement'].reduce((sum,key)=>sum+payload[key].length,0);
  const hasLegacy=Boolean(legacyError)||count(legacy)>0||!model.equal(legacy,model.empty());
  function canLegacy(){try{const owner=localStorage.getItem(prefix+'legacy-owner');return hasLegacy&&(!owner||owner===state.user?.id)}catch{return false}}
  function bindLegacy(){try{localStorage.setItem(prefix+'legacy-owner',state.user.id);return true}catch{setError('Não foi possível vincular os registros anteriores. Baixe um backup antes de tentar novamente.');return false}}
  function cacheKey(){return prefix+state.user.id}
  function persist(){if(!state.user)return;try{localStorage.setItem(cacheKey(),JSON.stringify({schemaVersion:1,verifiedOwner:state.user.id,approved:true,email:state.user.email||'',fullName:state.user.user_metadata?.full_name||'',base:state.base,draft:model.snapshot(data),revision:state.revision,syncedAt:state.syncedAt,migrated:state.migrated}))}catch{state.status='error';state.message='Não foi possível guardar as alterações neste dispositivo. Exporte um backup antes de fechar.'}}
  function editing(){return formDirty||Boolean(document.activeElement?.closest('#app input,#app textarea,#app select,#modal input,#modal textarea,#modal select'))}
  function status(){
    const el=$('account-status'),button=$('account-launch');if(button){button.classList.remove('hidden');button.textContent=state.user?'Minha conta':'Entrar'}
    for(const action of ['create','search','theme'])document.querySelectorAll('.header [data-action="'+action+'"]').forEach(button=>button.disabled=!state.user);
    if(!el)return;el.classList.remove('hidden');
    const dirty=state.user&&!model.equal(state.base,model.snapshot(data));
    const label=!state.user?state.message||'Entre para sincronizar seus registros.':state.status==='conflict'?'Há alterações diferentes em dois dispositivos. Escolha qual manter.':state.status==='error'?state.message:!navigator.onLine?'Sem internet · alterações guardadas neste dispositivo.':state.status==='syncing'?'Sincronizando seus registros...':dirty?'Alterações guardadas neste dispositivo · aguardando envio.':state.syncedAt?'Sincronizado · '+new Date(state.syncedAt).toLocaleTimeString('pt-BR',{timeZone:ZONE,hour:'2-digit',minute:'2-digit'}):'Conta conectada · lendo registros...';
    el.innerHTML='<span>'+esc(label)+'</span>'+(state.user?btn(state.status==='conflict'?'Resolver alterações':'Sincronizar agora',state.status==='conflict'?'account-conflicts':'account-sync'):'');
  }
  function loginView(){if(state.pendingUser)return '<section class="panel account-welcome"><img src="/icons/app-192-v2.png" width="64" height="64" alt=""><span class="mr-eyebrow">Cadastro recebido</span><h2>Aguardando aprovação</h2><p><strong>'+esc(state.pendingUser.user_metadata?.full_name||'Sua conta')+'</strong><br><span class="tiny">'+esc(state.pendingUser.email||'')+'</span></p><p class="muted">Sua conta foi criada. O administrador precisa liberar seu acesso antes de você usar o Planejamento.</p><p class="tiny" role="status">'+esc(state.message)+'</p><div class="pill-row">'+btn('Verificar aprovação','account-check-approval','','btn btn-primary')+btn('Sair','account-logout')+'</div></section>';return '<section class="panel account-welcome"><img src="/icons/app-192-v2.png" width="64" height="64" alt=""><span class="mr-eyebrow">Um planejamento em todos os dispositivos</span><h2>Entre no seu Planejamento</h2><p class="muted">Suas tarefas, estudos, agenda e configurações acompanham você no Mac, celular e iPad.</p><form id="account-login-form"><label class="field-label">Nome <span class="tiny">(para criar sua conta)</span><input class="field" type="text" name="fullName" autocomplete="name" maxlength="100" placeholder="Como você quer ser chamado?"></label><label class="field-label">E-mail<input class="field" type="email" name="email" autocomplete="username" required></label><label class="field-label">Senha<input class="field" type="password" name="password" autocomplete="current-password" minlength="6" required></label><p id="account-form-status" class="tiny" role="status"></p><div class="pill-row"><button type="submit" class="btn btn-primary" name="intent" value="login">Entrar</button><button type="submit" class="btn" name="intent" value="signup">Criar minha conta</button></div></form><p class="tiny">Use a mesma conta do Planejamento em todos os dispositivos. Sua conexão com o MedReview continua disponível na tela Revisões.</p>'+(canLegacy()?'<div class="account-legacy"><strong>Há registros salvos neste dispositivo</strong><p class="tiny">Depois de entrar, você poderá trazê-los para sua conta. Eles não serão apagados.</p>'+btn('Baixar cópia dos registros locais','account-legacy-backup')+'</div>':'')+'</section>'}
  function accountPanel(){return panel('Sua conta e sincronização','<p><strong>'+esc(state.user.user_metadata?.full_name||'Sua conta')+'</strong><br><span class="tiny">'+esc(state.user.email||'')+'</span></p><p class="tiny">Entre com esta conta no Mac, celular e iPad. Os registros são sincronizados quando há internet. Alterações offline aguardam envio neste dispositivo.</p><div class="pill-row">'+btn('Sincronizar agora','account-sync','','btn btn-primary')+btn('Sair da conta','account-logout')+'</div>')}
  function migrationPanel(){if(state.migrated||!canLegacy())return '';if(legacyError)return panel('Preservamos seus registros anteriores','<p class="tiny">Os registros locais precisam de revisão antes da importação: '+esc(legacyError)+'</p>'+btn('Baixar cópia dos registros anteriores','account-legacy-backup'));return panel('Trazer registros deste dispositivo','<p class="tiny">Encontramos registros e ajustes anteriores ao login ('+count(legacy)+' registros). Você pode acrescentá-los à sua conta, mantendo os identificadores para não duplicar os mesmos registros.</p><div class="pill-row">'+btn('Trazer meus registros','account-migrate','','btn btn-primary')+btn('Baixar cópia local','account-legacy-backup')+btn('Não trazer neste dispositivo','account-skip-migration')+'</div>')}
  render=function(){if(!state.user){nav();$('app').innerHTML=loginView();renderAcademicStatus()}else {previousRender();const migration=migrationPanel();if(migration)$('app').insertAdjacentHTML('afterbegin',migration);if(page==='settings')$('app').insertAdjacentHTML('afterbegin',accountPanel())}document.body.classList.remove('account-boot');status()};
  goto=function(target){formDirty=false;previousGoto(target);if(queuedRemote){queuedRemote=false;sync()}};
  save=function(){if(!state.user){notify('Entre na sua conta para salvar registros.');return}formDirty=false;state.status=state.conflicts?'conflict':navigator.onLine?'pending':'offline';persist();status();if(timer)clearTimeout(timer);timer=setTimeout(()=>sync(),450)};
  document.addEventListener('input',event=>{if(event.target.closest('#app,#modal')&&event.target.matches('input:not([type=checkbox]):not([type=file]),textarea,select'))formDirty=true});
  document.addEventListener('focusout',()=>{if(!formDirty&&queuedRemote)setTimeout(()=>{queuedRemote=false;sync()},0)});
  function setError(message){state.status='error';state.message=message;status()}
  async function read(owner,token){const {data:rows,error}=await client.from('planejamento_documents').select('revision,schema_version,payload').eq('user_id',owner).limit(1).setHeader('Authorization','Bearer '+token);if(error)throw Error('Não foi possível ler seus registros. Confira a conexão e a configuração do banco.');const row=rows?.[0];if(!row)return {revision:0,payload:model.empty()};if(!Number.isSafeInteger(Number(row.revision))||Number(row.revision)<1)throw Error('Revisão da conta inválida. Seus registros locais foram preservados.');if(row.schema_version!==1)throw Error('Atualize o aplicativo para abrir estes registros.');return {revision:Number(row.revision),payload:model.snapshot(row.payload)}}
  async function sync(preference){
    if(!state.user)return;if(migrationConflict){state.status='conflict';status();return}if(!navigator.onLine){state.status='offline';persist();status();return}if(editing()){queuedRemote=true;status();return}if(flight)return flight;
    const owner=state.user.id,token=state.accessToken,current=generation;if(!token){setError('Conecte sua conta novamente para sincronizar.');return}
    state.status='syncing';status();
    const task=(async()=>{
      try{
        for(let attempt=0;attempt<4;attempt++){
          const profile=await approval(owner,token);if(current!==generation||state.user?.id!==owner)return;if(!profile?.approved){awaitApproval(state.user);return}
          const remote=await read(owner,token);if(current!==generation||state.user?.id!==owner)return;
          if(editing()){queuedRemote=true;state.status='pending';status();return}
          if(preference&&state.conflicts&&state.conflicts.revision!==remote.revision)preference=undefined;
          const local=model.snapshot(data),result=model.merge(state.base,local,remote.payload,preference);
          if(result.conflicts.length&&!preference){state.conflicts={base:state.base,local,remote:remote.payload,revision:remote.revision};state.status='conflict';persist();status();return}
          let ack=remote;
          if(!model.equal(result.payload,remote.payload)){
            const {data:written,error}=await client.rpc('planejamento_write',{expected_revision:remote.revision,new_payload:result.payload}).setHeader('Authorization','Bearer '+token);
            if(error){if(error.code==='PT409'){preference=undefined;continue}throw Error('Suas alterações continuam neste dispositivo. O envio ao Supabase não foi concluído; tente novamente.')}
            if(written?.schema_version!==1||!Number.isSafeInteger(Number(written.revision)))throw Error('Resposta de sincronização inválida. Seus registros locais foram preservados.');
            ack={revision:Number(written.revision),payload:model.snapshot(written.payload)};
          }
          if(current!==generation||state.user?.id!==owner)return;
          if(editing()){queuedRemote=true;state.status='pending';persist();status();return}
          const latest=model.merge(local,model.snapshot(data),ack.payload);
          if(latest.conflicts.length){state.conflicts={base:state.base,local:model.snapshot(data),remote:ack.payload,revision:ack.revision};state.status='conflict';persist();status();return}
          state.base=ack.payload;state.revision=ack.revision;state.syncedAt=new Date().toISOString();state.conflicts=null;
          data=latest.payload;state.status='synced';state.message='';persist();render();
          if(!model.equal(data,state.base)){preference=undefined;continue}return;
        }
        setError('Os registros continuam mudando em outro dispositivo. Suas alterações locais estão guardadas; tente sincronizar novamente.');
      }catch(error){if(current===generation){setError(error.message);persist()}}
    })();flight=task;await task;if(flight===task)flight=null;
  }
  function reset(){generation++;if(channel)client.removeChannel(channel);channel=null;if(timer)clearTimeout(timer);timer=null;flight=null;queuedRemote=false;formDirty=false;state.user=null;state.pendingUser=null;state.accessToken=null;state.base=model.empty();state.revision=0;state.conflicts=null;migrationConflict=false;state.syncedAt=null;state.migrated=false;data=model.empty();if(interval){clearInterval(interval);interval=null}closeModal()}
  function resumeOffline(){
    if(navigator.onLine)return false;
    try{
      const owner=localStorage.getItem(prefix+'last-owner');if(!owner)return false;
      const cache=JSON.parse(localStorage.getItem(prefix+owner));if(cache?.schemaVersion!==1||cache.verifiedOwner!==owner||cache.approved!==true)return false;
      if(state.user?.id===owner){state.accessToken=null;state.status='offline';status();return true}
      const base=model.snapshot(cache.base),draft=model.snapshot(cache.draft);
      reset();state.user={id:owner,email:cache.email||'',user_metadata:{full_name:cache.fullName||''}};state.base=base;data=draft;state.revision=cache.revision||0;state.syncedAt=cache.syncedAt||null;state.migrated=Boolean(cache.migrated);state.status='offline';render();return true;
    }catch{return false}
  }
  async function approval(owner,token){
    const {data:profiles,error}=await client.from('profiles').select('id,name,approved').eq('id',owner).limit(1).setHeader('Authorization','Bearer '+token);
    if(error)throw Error('Não foi possível verificar a aprovação da sua conta. Tente novamente com internet.');
    return profiles?.[0];
  }
  function awaitApproval(user,message='Assim que o administrador liberar seu acesso, você poderá entrar.'){
    if(state.user)persist();
    try{localStorage.removeItem(prefix+'last-owner');const key=prefix+user.id,cache=JSON.parse(localStorage.getItem(key));if(cache){cache.approved=false;localStorage.setItem(key,JSON.stringify(cache))}}catch{}
    reset();window.MedReviewConnection?.disconnect?.();state.pendingUser=user;state.status='awaiting-approval';state.message=message;render();
  }
  async function checkApproval(){
    try{const {data:auth}=await client.auth.getSession();await acceptSession(auth.session)}catch{state.message='Não foi possível verificar a aprovação. Confira sua internet e tente novamente.';render()}
  }
  async function acceptSession(session){
    if(!session){if(resumeOffline())return;reset();state.status='disconnected';state.message='Entre para sincronizar seus registros.';render();return}
    const {data:active}=await client.auth.getSession();if(active.session?.access_token!==session.access_token)return;
    if(state.user&&state.user.id!==session.user?.id){persist();reset()}
    const current=generation;let user=session.user;
    if(navigator.onLine){const {data:identity,error}=await client.auth.getUser(session.access_token);if(current!==generation)return;if(error||!identity.user){reset();state.status='error';state.message='Conecte sua conta novamente para consultar seus registros.';render();return}user=identity.user}
    if(!user?.id)return;
    if(navigator.onLine){let profile;try{profile=await approval(user.id,session.access_token)}catch(error){if(current===generation)awaitApproval(user,error.message);return}if(current!==generation)return;if(profile?.approved!==true){awaitApproval(user);return}if(profile.name)user={...user,user_metadata:{...user.user_metadata,full_name:profile.name}}}
    const {data:latestSession}=await client.auth.getSession();if(current!==generation||latestSession.session?.access_token!==session.access_token)return;
    if(state.user?.id!==user.id){
      let cache=null;try{cache=JSON.parse(localStorage.getItem(prefix+user.id))}catch{}
      if(!navigator.onLine&&(!cache||cache.verifiedOwner!==user.id||cache.approved!==true)){reset();state.message='Conecte-se à internet para entrar neste dispositivo pela primeira vez.';render();return}
      reset();state.user=user;state.accessToken=session.access_token;
      try{if(localStorage.getItem(prefix+'last-owner')!==user.id)window.MedReviewConnection?.disconnect?.();localStorage.setItem(prefix+'last-owner',user.id)}catch{window.MedReviewConnection?.disconnect?.()}
      if(cache?.schemaVersion===1&&cache.verifiedOwner===user.id){try{state.base=model.snapshot(cache.base);data=model.snapshot(cache.draft);state.revision=cache.revision||0;state.syncedAt=cache.syncedAt||null;state.migrated=Boolean(cache.migrated)}catch{setError('O cache da conta precisa de revisão. Seus registros originais não foram apagados.');return}}
      else data=model.empty();persist();render();
    }
    state.accessToken=session.access_token;
    if(!channel){channel=client.channel('planejamento-own-'+user.id).on('postgres_changes',{event:'*',schema:'public',table:'planejamento_documents',filter:'user_id=eq.'+user.id},()=>sync()).subscribe()}
    await sync();
  }
  function authError(error,intent){
    const messages={
      signup_disabled:'A criação de contas está temporariamente indisponível. Tente novamente mais tarde.',
      email_provider_disabled:'O acesso por e-mail está temporariamente indisponível. Tente novamente mais tarde.',
      over_email_send_rate_limit:'O limite de envio de e-mails foi atingido. Aguarde alguns minutos antes de tentar novamente.',
      over_request_rate_limit:'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.',
      weak_password:'Use uma senha com pelo menos 6 caracteres. Evite senhas comuns ou fáceis de adivinhar.',
      email_address_invalid:'Confira se o endereço de e-mail está completo e correto.',
      validation_failed:'Confira o e-mail e use uma senha com pelo menos 6 caracteres.',
      user_already_exists:'Já existe uma conta com este e-mail. Use Entrar para acessá-la.',
      email_not_confirmed:'Confirme sua conta pelo link enviado ao seu e-mail antes de entrar.',
      invalid_credentials:'E-mail ou senha incorretos. Confira os dados e tente novamente.'
    };
    return messages[error?.code]||(error?.status===429?'Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.':error?.name==='AuthRetryableFetchError'?'Não foi possível conectar ao serviço. Verifique sua internet e tente novamente.':intent==='signup'?'Não foi possível criar a conta agora. Tente novamente em alguns minutos.':'Não foi possível entrar agora. Tente novamente em alguns minutos.');
  }
  async function authenticate(event){
    event.preventDefault();const form=event.target,output=$('account-form-status');if(!navigator.onLine){output.textContent='Conecte-se à internet para entrar ou criar sua conta.';return}
    const intent=event.submitter?.value||'login',email=form.elements.email.value.trim(),password=form.elements.password.value,fullName=form.elements.fullName.value.trim(),buttons=[...form.querySelectorAll('button')];
    if(intent==='signup'&&!fullName){output.textContent='Informe seu nome para criar a conta.';form.elements.fullName.focus();return}
    buttons.forEach(button=>button.disabled=true);output.textContent=intent==='signup'?'Criando sua conta...':'Entrando...';
    try{
      const result=intent==='signup'?await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/',data:{full_name:fullName}}}):await client.auth.signInWithPassword({email,password});
      form.elements.password.value='';if(result.error){output.textContent=authError(result.error,intent);return}formDirty=false;
      if(!result.data.session){output.textContent='Confira seu e-mail e confirme a conta para entrar.';return}await acceptSession(result.data.session);
    }catch(error){form.elements.password.value='';output.textContent=authError(error,intent)}finally{buttons.forEach(button=>button.disabled=false)}
  }
  function showAccount(){if(!state.user){goto('settings');return}$('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button>'+accountPanel()+'</div>';$('modal').classList.remove('hidden')}
  function showConflicts(){if(!state.conflicts)return;$('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><h2>Escolha quais alterações manter</h2><p>O mesmo campo foi alterado de formas diferentes neste dispositivo e na conta. As demais alterações serão combinadas.</p><p class="tiny">Baixe uma cópia antes de escolher, se quiser comparar depois.</p><div class="pill-row">'+btn('Baixar esta versão','backup')+btn('Manter alterações deste dispositivo','account-conflict-local','','btn btn-primary')+btn('Manter alterações da conta','account-conflict-remote')+'</div></div>';$('modal').classList.remove('hidden')}
  async function logout(){if(state.user)persist();try{localStorage.removeItem(prefix+'last-owner')}catch{}reset();window.MedReviewConnection?.disconnect?.();await client.auth.signOut({scope:'local'});state.status='disconnected';state.message='Você saiu da conta. Os dados da conta estão ocultos neste dispositivo.';render()}
  document.addEventListener('submit',event=>{if(event.target.id==='account-login-form')authenticate(event)});
  document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;switch(button.dataset.action){
    case'account-check-approval':checkApproval();break;case'account-open':showAccount();break;case'account-sync':sync();break;case'account-logout':logout();break;case'account-conflicts':showConflicts();break;
    case'account-legacy-backup':{if(!canLegacy())break;const current=data;data=originalLegacy;backup();data=current;break}
    case'account-skip-migration':state.migrated=true;persist();render();break;
    case'account-migrate':{if(!canLegacy())break;const result=model.merge(model.empty(),legacy,model.snapshot(data));if(result.conflicts.length){migrationConflict=true;state.conflicts={migration:true};state.status='conflict';showConflicts();status();break}if(!bindLegacy())break;data=result.payload;state.migrated=true;save();render();break}
    case'account-conflict-local':case'account-conflict-remote':closeModal();formDirty=false;{const preference=button.dataset.action.endsWith('remote')?'remote':'local';if(migrationConflict){if(!bindLegacy())break;data=model.merge(model.empty(),legacy,model.snapshot(data),preference).payload;state.migrated=true;migrationConflict=false;state.conflicts=null;save();render()}else sync(preference)}break;
  }});
  client.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'){if(resumeOffline())return;reset();state.message='Entre para sincronizar seus registros.';render()}else if(['SIGNED_IN','TOKEN_REFRESHED','PASSWORD_RECOVERY'].includes(event))setTimeout(()=>acceptSession(session),0)});
  const refresh=()=>{if(document.visibilityState==='visible'){if(state.user)sync();else if(state.pendingUser&&navigator.onLine)checkApproval()}};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);setInterval(refresh,30000);
  window.addEventListener('offline',()=>{state.status='offline';status()});window.addEventListener('online',async()=>{try{const {data:auth}=await client.auth.getSession();if(auth.session)await acceptSession(auth.session)}catch{setError('Não foi possível retomar a conta. Suas alterações locais continuam guardadas.')}});
  window.PlanningAccount={enabled:true,get status(){return state.status},get user(){return state.user},sync,logout};
  state.message='Entre para sincronizar seus registros.';if(!resumeOffline())render();client.auth.getSession().then(({data:auth})=>acceptSession(auth.session)).catch(()=>{state.message='Não foi possível iniciar sua conta. Atualize a página.';render()});
})();
