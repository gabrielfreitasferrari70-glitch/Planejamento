(function () {
  'use strict';

  // Credentials belong to one account; the owner's configured key stays server-side.
  const ownKey=()=>window.PlanningAccount?.user?.id?'planejamento-whatsapp-key:'+PlanningAccount.user.id:null;
  const ownerConfigured=()=>Boolean(PlanningAccount?.user?.id&&PlanningAccount.user.id===window.PLANNING_CONFIG?.legacyOwnerId);
  function localKey(){try{return ownKey()?localStorage.getItem(ownKey())||'':''}catch{return ''}}
  function getWhatsAppConfig() {
    if (!data.settings) data.settings = {};
    return {
      phone: data.settings.whatsappPhone || '',
      apiKey: localKey(),
      autoDaily: !!data.settings.whatsappAutoDaily,
      lastSentDate: data.settings.whatsappLastSentDate || ''
    };
  }

  function setWhatsAppConfig(cfg) {
    if (!data.settings) data.settings = {};
    if (cfg.phone !== undefined) data.settings.whatsappPhone = cfg.phone;
    if (cfg.apiKey !== undefined && ownKey()) {try{localStorage.setItem(ownKey(),cfg.apiKey)}catch{notify('Não foi possível guardar a chave neste dispositivo.')}}
    if (cfg.autoDaily !== undefined) data.settings.whatsappAutoDaily = cfg.autoDaily;
    if (cfg.lastSentDate !== undefined) data.settings.whatsappLastSentDate = cfg.lastSentDate;
    save();
  }

  // Gera o resumo diário do dia formatado para WhatsApp
  function generateDailySummary() {
    const todayStr = today();
    const dateFormatted = fmt(todayStr, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC'
    });

    // Saudação de acordo com o horário de Cuiabá
    const nowHour = parseInt(
      new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Cuiaba', hour: 'numeric', hour12: false }).format(new Date()),
      10
    );
    const greeting = nowHour < 12 ? 'Bom dia' : nowHour < 18 ? 'Boa tarde' : 'Boa noite';

    let lines = [
      `👋 *${greeting}, ${window.PlanningAccount?.user?.user_metadata?.full_name||'estudante'}!*`,
      `📋 *Planejamento Medicina · Resumo de Hoje*`,
      `📅 _${dateFormatted}_\n`
    ];

    // 1. Compromissos e Aulas do dia
    const todayEvents = events().filter(x => x.date === todayStr);
    lines.push(`⏰ *AULAS E COMPROMISSOS (${todayEvents.length}):*`);
    if (todayEvents.length === 0) {
      lines.push('• _Nenhum compromisso previsto no cronograma de hoje._');
    } else {
      todayEvents.forEach(ev => {
        const timeStr = ev.from ? `[${ev.from}${ev.to ? ' - ' + ev.to : ''}] ` : '';
        const prof = ev.professor ? ` (${ev.professor})` : '';
        lines.push(`• ${timeStr}${ev.title}${prof}`);
      });
    }
    lines.push('');

    // 2. Revisões Pendentes
    const dueReviews = data.reviews.filter(x => !x.done && x.due <= todayStr);
    lines.push(`↻ *REVISÕES PENDENTES (${dueReviews.length}):*`);
    if (dueReviews.length === 0) {
      lines.push('• _Nenhuma revisão pendente para hoje. Parabéns!_');
    } else {
      dueReviews.slice(0, 8).forEach(r => {
        const late = r.due < todayStr ? ' ⚠️ *atrasada*' : '';
        lines.push(`• ${r.topic} (${r.subject || 'UC2'}${r.interval ? ` · D+${r.interval}` : ''})${late}`);
      });
      if (dueReviews.length > 8) {
        lines.push(`• _... e mais ${dueReviews.length - 8} revisões._`);
      }
    }
    lines.push('');

    // 3. Tarefas Prioritárias
    const pendingTasks = data.tasks.filter(x => !x.done);
    lines.push(`☑ *TAREFAS PENDENTES (${pendingTasks.length}):*`);
    if (pendingTasks.length === 0) {
      lines.push('• _Todas as tarefas concluídas!_');
    } else {
      pendingTasks.slice(0, 6).forEach(t => {
        const prio = t.priority === '3' ? ' 🔴' : t.priority === '2' ? ' 🟡' : '';
        const limit = t.date ? ` (prazo: ${fmt(t.date)})` : '';
        lines.push(`• ${t.title}${prio}${limit}`);
      });
      if (pendingTasks.length > 6) {
        lines.push(`• _... e mais ${pendingTasks.length - 6} tarefas._`);
      }
    }
    lines.push('');

    // 4. Próxima Prova / Avaliação
    const exam = nextExam();
    if (exam) {
      const days = Math.round((Date.parse(exam.date + 'T12:00:00Z') - Date.parse(todayStr + 'T12:00:00Z')) / 86400000);
      const daysText = days < 0 ? 'já realizada' : days === 0 ? 'HOJE!' : days === 1 ? 'amanhã!' : `em ${days} dias (${fmt(exam.date)})`;
      lines.push(`⚑ *PRÓXIMA AVALIAÇÃO:*`);
      lines.push(`• *${exam.title}*: ${daysText}`);
      lines.push('');
    }

    lines.push(`🔗 Acesse: https://planejamento-medicina-independente.vercel.app`);
    return lines.join('\n');
  }

  async function sendWhatsApp(text) {
    if(!window.PlanningAccount?.user){notify('Entre na sua conta para enviar seu resumo.');return false}
    const cfg=getWhatsAppConfig();
    if(!cfg.phone||(!cfg.apiKey&&!ownerConfigured())){notify('Preencha seu WhatsApp e chave CallMeBot nas Configurações.');return false}
    try{await PlanningAccount.sendWhatsApp(text,cfg.phone,cfg.apiKey);notify('Resumo enviado para o seu WhatsApp.');return true}
    catch(error){notify(error.message);return false}
  }

  // Painel de Configurações do WhatsApp
  function panelWhatsApp() {
    const cfg = getWhatsAppConfig();
    return panel(
      'Notificações no WhatsApp · CallMeBot',
      '<div class="source-box"><span class="source-icon">📲</span><div>' +
      '<strong>Avisos e resumos diários no seu celular</strong>' +
      '<p>Envie resumos da sua rotina acadêmica, revisões pendentes e provas diretamente para o WhatsApp pela sua conta CallMeBot.</p>' +
      '</div></div>' +
      '<label class="field-label">Seu WhatsApp (DDI + DDD + Número)<input id="wa-phone" class="field" value="' + esc(cfg.phone) + '" placeholder="Ex.: 5565999882979"></label>' +
      '<label class="field-label">Chave API (APIKey do CallMeBot)<input id="wa-key" type="password" autocomplete="off" class="field" value="' + esc(cfg.apiKey) + '" placeholder="Sua chave CallMeBot"></label>' +
      '<label class="field-label" style="display:flex;align-items:center;gap:8px;margin:10px 0 16px;cursor:pointer">' +
      '<input type="checkbox" id="wa-autodaily" ' + (cfg.autoDaily ? 'checked' : '') + ' style="width:17px;height:17px"> ' +
      '<span>Enviar resumo matinal automaticamente ao abrir o app (1x ao dia)</span></label>' +
      '<div class="pill-row">' +
      btn('Salvar configurações do WhatsApp', 'save-whatsapp', '', 'btn btn-primary') +
      btn('📲 Enviar resumo de hoje agora', 'send-whatsapp-now', '', 'btn') +
      btn('Testar aviso simples', 'test-whatsapp-simple', '', 'btn btn-ghost') +
      '</div><p class="tiny">A chave pessoal fica neste dispositivo e não entra nos backups. A configuração do proprietário fica no servidor.</p>'
    );
  }

  // Hook no render para injetar o painel nas Configurações e o botão no Header
  const prevRender = render;
  render = function () {
    prevRender();
    const allowed=Boolean(window.PlanningAccount?.user);
    const existing=document.getElementById('btn-whatsapp-header');if(existing)existing.hidden=!allowed;
    if(!allowed)return;

    // Injeta botão no cabeçalho se ainda não existir
    const headerActions = document.querySelector('.header-actions');
    if (headerActions && !document.getElementById('btn-whatsapp-header')) {
      const waBtn = document.createElement('button');
      waBtn.id = 'btn-whatsapp-header';
      waBtn.className = 'btn btn-ghost';
      waBtn.setAttribute('data-action', 'send-whatsapp-now');
      waBtn.setAttribute('title', 'Enviar resumo de hoje para o seu WhatsApp');
      waBtn.innerHTML = '📲 <span>WhatsApp</span>';
      headerActions.insertBefore(waBtn, headerActions.firstChild);
    }

    if (page === 'settings') {
      const app = $('app');
      if (app) app.insertAdjacentHTML('beforeend', panelWhatsApp());
    }

    // Auto-envio diário se ativado
    checkAutoDaily();
  };

  let sending=false;
  async function checkAutoDaily() {
    if(!PlanningAccount?.user||sending)return;
    const cfg=getWhatsAppConfig(),todayStr=today(),owner=PlanningAccount.user.id;
    if(cfg.autoDaily&&cfg.lastSentDate!==todayStr){sending=true;try{if(await sendWhatsApp(generateDailySummary())&&PlanningAccount.user?.id===owner)setWhatsAppConfig({lastSentDate:todayStr})}finally{sending=false}}
  }

  // Listener para as ações do WhatsApp
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;

    if (action === 'save-whatsapp') {
      const phone = ($('wa-phone')?.value || '').trim().replace(/\D/g, '');
      const apiKey = ($('wa-key')?.value || '').trim();
      const autoDaily = $('wa-autodaily')?.checked || false;
      if (!phone || (!apiKey&&!ownerConfigured())) {
        notify('Preencha seu número e chave API.');
        return;
      }
      setWhatsAppConfig({ phone, apiKey, autoDaily });
      notify('Configurações do WhatsApp salvas com sucesso!');
    } else if (action === 'send-whatsapp-now') {
      const summary = generateDailySummary();
      sendWhatsApp(summary);
    } else if (action === 'test-whatsapp-simple') {
      sendWhatsApp('🔔 *Planejamento Medicina*: Teste de notificação funcionando perfeitamente!');
    }
  });

  // Exporta para escopo global
  globalThis.sendWhatsAppDailySummary = () => sendWhatsApp(generateDailySummary());
})();
