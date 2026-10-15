'use strict';
(function(){
  let installPrompt=null,registration=null;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function appPanel(){return panel('Planejamento no seu celular e iPad','<p class="tiny">Instale na tela inicial para abrir como app. '+(window.PlanningAccount?.enabled?'Entre com a mesma conta para sincronizar tarefas e estudos entre seus dispositivos.':'Tarefas e estudos ficam neste dispositivo.')+' O cronograma e o planejamento abrem sem internet após o primeiro carregamento; MedReview e Drive precisam de conexão.</p>'+btn(standalone()?'App instalado':'Instalar aplicativo','app-install','','btn btn-primary')+'<p class="tiny" id="app-install-status">'+(standalone()?'Você está usando a versão instalada.':'No iPhone e iPad, abra no Safari e escolha Adicionar à Tela de Início.')+'</p>')}
  const previousRender=render;
  render=function(){previousRender();if(page==='settings')$('app').insertAdjacentHTML('afterbegin',appPanel());updateNotices()};
  const previousGoto=goto;
  const valid=id=>MENU.some(item=>item[0]===id);
  goto=function(id){if(!valid(id))return;if(location.hash!=='#'+id)history.pushState({page:id},'',location.pathname+location.search+'#'+id);previousGoto(id)};
  function restorePage(){const id=location.hash.slice(1);if(valid(id))previousGoto(id);else previousGoto('dashboard')}
  window.addEventListener('popstate',()=>{closeModal();restorePage()});
  window.addEventListener('hashchange',()=>{if(location.hash.slice(1)!==page)restorePage()});
  function updateNotices(){
    const offline=$('app-offline');if(offline)offline.classList.toggle('hidden',navigator.onLine);
    const install=$('app-install-launch');if(install)install.classList.toggle('hidden',standalone());
    const theme=$('app-theme-color');if(theme)theme.content=(typeof effectiveTheme==='function'?effectiveTheme():data.settings.theme)==='dark'?'#111a28':'#f6f7fa';
  }
  function installHelp(){
    const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const steps=ios?['Abra este site no Safari.','Toque em Compartilhar (quadrado com seta para cima).','Escolha Adicionar à Tela de Início e confirme Adicionar.']:['Abra este site no Chrome, Edge ou outro navegador com instalação de apps.','Abra o menu do navegador e escolha Instalar aplicativo ou Adicionar à tela inicial.','Confirme a instalação e abra pelo ícone Planejamento.'];
    $('modal').innerHTML='<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="install-title"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><img class="app-install-icon" src="/icons/app-192-v2.png" width="64" height="64" alt=""><h2 id="install-title">'+(standalone()?'Seu app está instalado':'Leve seu planejamento com você')+'</h2>'+(standalone()?'<p>Abra pelo ícone na tela inicial. Seus registros permanecem neste dispositivo.</p>':'<ol class="install-steps">'+steps.map(step=>'<li>'+step+'</li>').join('')+'<p>Depois de instalar, abra pelo ícone para usar em tela própria.</p>')+'<p class="tiny">A instalação usa o navegador, sem App Store. Guarde um backup nas Configurações antes de instalar ou trocar de dispositivo.</p></div>';
    $('modal').classList.remove('hidden');
  }
  async function install(){if(!installPrompt||standalone()){installHelp();return}const prompt=installPrompt;installPrompt=null;await prompt.prompt();const result=await prompt.userChoice;if(result.outcome!=='accepted')installHelp()}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;updateNotices()});
  window.addEventListener('appinstalled',()=>{installPrompt=null;updateNotices();if(page==='settings')render();notify('Planejamento instalado na tela inicial.')});
  window.addEventListener('online',updateNotices);window.addEventListener('offline',updateNotices);
  document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;if(button.dataset.action==='app-install')install().catch(()=>installHelp());if(button.dataset.action==='app-update'){if(registration?.waiting){sessionStorage.setItem('planning-update-requested','1');registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});$('app-update').classList.add('hidden')}}});
  function viewport(){document.documentElement.style.setProperty('--app-visible-height',(window.visualViewport?.height||innerHeight)+'px')}
  window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
  if('serviceWorker' in navigator&&window.isSecureContext){
    navigator.serviceWorker.register('/sw.js').then(reg=>{
      registration=reg;
      const showUpdate=()=>{if(reg.waiting&&navigator.serviceWorker.controller)$('app-update').classList.remove('hidden')};
      showUpdate();reg.addEventListener('updatefound',()=>{const worker=reg.installing;worker?.addEventListener('statechange',()=>{if(worker.state==='installed')showUpdate()})});
    }).catch(()=>{const status=$('app-install-status');if(status)status.textContent='O site continua disponível. O acesso sem internet não foi preparado; tente novamente com conexão.'});
    let updating=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updating)return;if(registration?.active&&sessionStorage.getItem('planning-update-requested')){sessionStorage.removeItem('planning-update-requested');updating=true;location.reload()}});
  }
  if(location.hash)restorePage();else render();
})();
