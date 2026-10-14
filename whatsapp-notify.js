(function () {
  'use strict';

  // Existing administrator features now use the verified account adapter.
  function isAdmin(){return Boolean(window.AccountFeatureData?.isOwner())}
  function getWhatsAppConfig(){return window.AccountFeatureData?.whatsapp()||{phone:'',apiKey:'',autoDaily:false,lastSentDate:''}}
  function setWhatsAppConfig(cfg){return window.AccountFeatureData?.saveWhatsApp(cfg)}

  // Gera o resumo das 05h (Briefing Matinal)
  function generateMorningSummary() {
    const todayStr = today();
    const dateFormatted = fmt(todayStr, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC'
    });

    let lines = [
      `🌅 *Bom dia, Gabriel!*`,
      `📋 *Planejamento Medicina · Cronograma de Hoje*`,
      `📅 _${dateFormatted}_\n`
    ];

    // 1. Aulas e Compromissos
    const todayEvents = events().filter(x => x.date === todayStr);
    lines.push(`⏰ *AULAS E COMPROMISSOS (${todayEvents.length}):*`);
    if (todayEvents.length === 0) {
      lines.push('• _Nenhum compromisso previsto no cronograma para hoje._');
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
    lines.push(`↻ *REVISÕES PARA HOJE (${dueReviews.length}):*`);
    if (dueReviews.length === 0) {
      lines.push('• _Nenhuma revisão pendente para hoje._');
    } else {
      dueReviews.slice(0, 7).forEach(r => {
        const late = r.due < todayStr ? ' ⚠️ *atrasada*' : '';
        lines.push(`• ${r.topic} (${r.subject || 'UC2'}${r.interval ? ` · D+${r.interval}` : ''})${late}`);
      });
      if (dueReviews.length > 7) {
        lines.push(`• _... e mais ${dueReviews.length - 7} revisões._`);
      }
    }
    lines.push('');

    // 3. Tarefas Prioritárias
    const pendingTasks = data.tasks.filter(x => !x.done);
    lines.push(`☑ *TAREFAS DO DIA (${pendingTasks.length}):*`);
    if (pendingTasks.length === 0) {
      lines.push('• _Sem tarefas pendentes._');
    } else {
      pendingTasks.slice(0, 5).forEach(t => {
        const prio = t.priority === '3' ? ' 🔴' : t.priority === '2' ? ' 🟡' : '';
        lines.push(`• ${t.title}${prio}`);
      });
    }
    lines.push('');

    // 4. Próxima Avaliação
    const exam = nextExam();
    if (exam) {
      const days = Math.round((Date.parse(exam.date + 'T12:00:00Z') - Date.parse(todayStr + 'T12:00:00Z')) / 86400000);
      const daysText = days === 0 ? 'HOJE!' : days === 1 ? 'amanhã!' : `em ${days} dias (${fmt(exam.date)})`;
      lines.push(`⚑ *PRÓXIMA AVALIAÇÃO:*`);
      lines.push(`• *${exam.title}*: ${daysText}\n`);
    }

    lines.push(`🔗 Acesse seu Planejamento: https://planejamento-medicina-independente.vercel.app`);
    return lines.join('\n');
  }

  // Gera o resumo das 22h (Fechamento do Dia com Link de Confirmação)
  function generateNightSummary() {
    const todayStr = today();
    const dateFormatted = fmt(todayStr, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC'
    });

    const todayEvents = events().filter(x => x.date === todayStr);

    let lines = [
      `🌙 *Boa noite, Gabriel!*`,
      `📋 *Fechamento do Dia · Planejamento Medicina*`,
      `📅 _${dateFormatted}_\n`
    ];

    lines.push(`⏰ *AULAS QUE ESTAVAM PREVISTAS HOJE (${todayEvents.length}):*`);
    if (todayEvents.length === 0) {
      lines.push('• _Nenhuma aula agendada para hoje._');
    } else {
      todayEvents.forEach(ev => {
        const timeStr = ev.from ? `[${ev.from}] ` : '';
        lines.push(`• ${timeStr}${ev.title}`);
      });
    }
    lines.push('');

    lines.push(`👉 *CONFIRMAÇÃO DO DIA:*`);
    lines.push(`Toque no link abaixo para marcar as aulas assistidas e direcionar suas revisões automáticas:`);
    lines.push(`🔗 https://planejamento-medicina-independente.vercel.app/?fechamento=${todayStr}`);

    return lines.join('\n');
  }

  // Disparo com envio veloz e fallbacks seguros
  async function sendWhatsApp(text) {
    if(!isAdmin())return false;
    const cfg=getWhatsAppConfig();notify('Enviando para o WhatsApp...');
    try{await PlanningAccount.sendWhatsApp(text,cfg.phone,cfg.apiKey);notify('Mensagem enviada para o seu WhatsApp! 📲');return true}
    catch(error){notify(error.message||'Não foi possível enviar a mensagem.');return false}
  }

  // MODAL INTERATIVO: Processo inverso de Fechamento do Dia
  function openDayClosingModal(targetDate) {
    if (!isAdmin()) return;
    const dateStr = targetDate || today();
    const formatted = fmt(dateStr, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const dayClasses = events().filter(x => x.date === dateStr && x.type !== 'study' && x.type !== 'review');
    const dayTasks = data.tasks.filter(x => !x.done || x.date === dateStr);

    let classesHTML = '';
    if (dayClasses.length === 0) {
      classesHTML = '<div class="empty">Nenhuma aula cadastrada nesta data no cronograma.</div>';
    } else {
      classesHTML = dayClasses.map((item, idx) => {
        const timeStr = item.from ? `[${item.from}${item.to ? ' - ' + item.to : ''}] ` : '';
        const prof = item.professor ? ` · ${esc(item.professor)}` : '';
        return `
          <div class="closing-card" data-closing-class="${idx}" data-title="${esc(item.title)}" data-subject="${esc(item.subject || 'UC2')}" data-from="${esc(item.from || '')}" data-to="${esc(item.to || '')}">
            <strong>${timeStr}${esc(item.title)}</strong>
            <small class="muted" style="display:block;margin:3px 0 10px">${esc(item.subject || 'UC2')}${prof}</small>
            <div class="pill-row">
              <label class="status-pill review">
                <input type="radio" name="class-status-${idx}" value="review" checked>
                <span>🟢 Vista → Revisão</span>
              </label>
              <label class="status-pill learn">
                <input type="radio" name="class-status-${idx}" value="learn">
                <span>🟡 Vista → Aprender</span>
              </label>
              <label class="status-pill missed">
                <input type="radio" name="class-status-${idx}" value="missed">
                <span>🔴 Não vista</span>
              </label>
            </div>
          </div>
        `;
      }).join('');
    }

    let tasksHTML = '';
    if (dayTasks.length > 0) {
      tasksHTML = `
        <h3 style="font-size:13px;margin:20px 0 8px;font-weight:750">Tarefas do Dia</h3>
        <div style="border:1px solid var(--border);border-radius:12px;padding:8px 14px;background:var(--bg)">
          ${dayTasks.map(t => `
            <label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);cursor:pointer">
              <input type="checkbox" data-closing-task="${esc(t.id)}" ${t.done ? 'checked' : ''} style="width:17px;height:17px">
              <span style="font-size:12.5px;${t.done ? 'text-decoration:line-through;color:var(--muted)' : ''}">${esc(t.title)}</span>
            </label>
          `).join('')}
        </div>
      `;
    }

    $('modal').innerHTML = `
      <div class="modal-card" style="max-width:640px" role="dialog" aria-modal="true" aria-labelledby="closing-title">
        <button type="button" class="close" data-action="close" aria-label="Fechar">×</button>
        <span class="mr-eyebrow">Fechamento do Dia · Conta Administradora</span>
        <h2 id="closing-title" style="margin-bottom:4px">Fechamento · ${formatted}</h2>
        <p class="muted" style="margin-bottom:18px">Confirme o que você assistiu e concluiu para calibrar suas revisões automáticas no MedReview e Planejamento.</p>

        <h3 style="font-size:13px;margin:10px 0 8px;font-weight:750">Aulas e Tutorias de Hoje</h3>
        ${classesHTML}
        ${tasksHTML}

        <div style="margin-top:18px">
          <label class="field-label">Reflexão do dia (opcional)
            <textarea id="closing-daily-note" class="field" rows="3" placeholder="O que funcionou bem? O que precisa de ajuste amanhã?">${esc(data.notes.find(x => x.date === dateStr)?.text || '')}</textarea>
          </label>
        </div>

        <div class="pill-row between" style="margin-top:22px">
          <button type="button" class="btn" data-action="close">Cancelar</button>
          <button type="button" class="btn btn-primary" data-action="save-day-closing" data-date="${dateStr}">✓ Confirmar e Gerar Revisões</button>
        </div>
      </div>
    `;
    $('modal').classList.remove('hidden');
  }

  // Salva o fechamento do dia e executa as ações automáticas
  function saveDayClosing(targetDate) {
    if (!isAdmin()) return;
    const dateStr = targetDate || today();
    const classCards = document.querySelectorAll('[data-closing-class]');

    let reviewsCreated = 0;
    let tasksCreated = 0;

    classCards.forEach(card => {
      const idx = card.dataset.closingClass;
      const title = card.dataset.title;
      const subject = card.dataset.subject || 'UC2';
      const from = card.dataset.from;
      const to = card.dataset.to;
      const status = card.querySelector(`input[name="class-status-${idx}"]:checked`)?.value || 'review';

      let duration = 90;
      if (from && to) {
        const mFrom = mins(from), mTo = mins(to);
        if (mTo > mFrom) duration = mTo - mFrom;
      }

      // Sincroniza com o ClassStatusTracker
      if (window.ClassStatusTracker) {
        const trackerList = window.ClassStatusTracker.getTrackedClasses();
        let found = trackerList.find(x => x.topic === title && x.date === dateStr);
        if (!found) {
          trackerList.push({
            id: uid(),
            topic: title,
            subject,
            date: dateStr,
            minutes: duration,
            professor: card.dataset.prof || '',
            status,
            votedAt: new Date().toISOString(),
            masteredAt: null
          });
        } else {
          found.status = status;
          found.votedAt = new Date().toISOString();
          if (status !== 'mastered') found.masteredAt = null;
        }
        window.ClassStatusTracker.saveTrackedClasses(trackerList);
      }

      if (status === 'review') {
        // 1. Vista e direcionada para revisão:

        const sessionId = uid();
        data.sessions.push({
          id: sessionId,
          subject,
          topic: title,
          date: dateStr,
          minutes: duration,
          questions: '',
          correct: ''
        });

        // Gera revisões com espaçamento inteligente
        const rawIntervals = String(data.settings.intervals || '7,25,50');
        const intervals = rawIntervals.split(',').map(x => Number(x.trim())).filter(x => Number.isInteger(x) && x > 0);
        const uniqueIntervals = [...new Set(intervals.length ? intervals : [7, 25, 50])];

        for (const n of uniqueIntervals) {
          data.reviews.push({
            id: uid(),
            sessionId,
            subject,
            topic: title,
            due: dayAdd(dateStr, n),
            interval: n,
            done: false
          });
          reviewsCreated++;
        }
      } else if (status === 'learn') {
        // 2. Vista e necessidade de aprender:
        data.tasks.push({
          id: uid(),
          title: `Aprender / Aprofundar: ${title}`,
          subject,
          date: dayAdd(dateStr, 2),
          priority: '3', // Alta
          estimate: 90,
          done: false
        });
        tasksCreated++;
      } else if (status === 'missed') {
        // 3. Não vista:
        data.tasks.push({
          id: uid(),
          title: `Repor aula não assistida: ${title}`,
          subject,
          date: dayAdd(dateStr, 3),
          priority: '2', // Média
          estimate: 60,
          done: false
        });
        tasksCreated++;
      }
    });

    // Atualiza status das tarefas marcadas no checklist
    const taskCheckboxes = document.querySelectorAll('[data-closing-task]');
    taskCheckboxes.forEach(chk => {
      const taskId = chk.dataset.closingTask;
      const t = data.tasks.find(x => x.id === taskId);
      if (t) t.done = chk.checked;
    });

    // Salva reflexão do dia
    const noteText = ($('closing-daily-note')?.value || '').trim();
    if (noteText) {
      const existingNote = data.notes.find(x => x.date === dateStr);
      if (existingNote) existingNote.text = noteText;
      else data.notes.push({ date: dateStr, text: noteText });
    }

    save();
    closeModal();
    render();

    // Limpa parâmetro da URL
    try {
      const cleanUrl = location.pathname + location.hash;
      window.history.replaceState({}, '', cleanUrl);
    } catch {}

    notify(`Fechamento concluído! ${reviewsCreated} revisões geradas, ${tasksCreated} tarefas agendadas.`);
  }

  // Painel de Configurações do WhatsApp (APENAS ADMINISTRADOR)
  function panelWhatsApp() {
    if (!isAdmin()) return '';
    const cfg = getWhatsAppConfig();
    return panel(
      'Notificações no WhatsApp · Administrador',
      '<div class="source-box"><span class="source-icon">📲</span><div>' +
      '<strong>Painel Privado de Notificações</strong>' +
      '<p>Recurso restrito à conta administradora de Gabriel. Disparos automáticos às 05:00 e 22:00 programados na Vercel.</p>' +
      '</div></div>' +
      '<label class="field-label">Seu WhatsApp (DDI + DDD + Número)<input id="wa-phone" class="field" value="' + esc(cfg.phone) + '" placeholder="Informe sua configuração pessoal"></label>' +
      '<label class="field-label">Chave API (APIKey do CallMeBot)<input id="wa-key" type="password" class="field" value="' + esc(cfg.apiKey) + '" placeholder="Informe sua configuração pessoal"></label>' +
      '<div class="pill-row">' +
      btn('Salvar dados do WhatsApp', 'save-whatsapp', '', 'btn btn-primary') +
      btn('📲 Disparar resumo matinal agora', 'send-morning-whatsapp', '', 'btn') +
      btn('🌙 Disparar fechamento noturno agora', 'send-night-whatsapp', '', 'btn') +
      btn('Testar Fechamento do Dia', 'open-day-closing', '', 'btn btn-ghost') +
      '</div>'
    );
  }

  // Hook no render com verificação de Admin
  const prevRender = (typeof render === 'function') ? render : (typeof window !== 'undefined' ? window.render : null);
  const customRender = function () {
    if (prevRender) prevRender();

    const headerActions = document.querySelector('.header-actions');
    const existingBtn = document.getElementById('btn-whatsapp-header');

    if (isAdmin()) {
      if (headerActions && !existingBtn) {
        const waBtn = document.createElement('button');
        waBtn.id = 'btn-whatsapp-header';
        waBtn.className = 'btn btn-ghost';
        waBtn.setAttribute('data-action', 'open-day-closing');
        waBtn.setAttribute('title', 'Fechamento do Dia (Administrador)');
        waBtn.innerHTML = '🌙 <span>Fechamento</span>';
        headerActions.insertBefore(waBtn, headerActions.firstChild);
      }

      if (page === 'today') {
        const app = $('app');
        if (app && !document.getElementById('card-fechamento-dia')) {
          const card = document.createElement('div');
          card.id = 'card-fechamento-dia';
          card.className = 'panel';
          card.style.borderColor = 'rgba(37, 211, 102, 0.4)';
          card.innerHTML = `
            <div class="pill-row between">
              <div>
                <strong>🌙 Fechamento do Dia · Aulas e Revisões</strong>
                <p class="tiny muted" style="margin:2px 0 0">Classifique as aulas assistidas hoje como Vista (Revisão), Aprender ou Não Vista.</p>
              </div>
              <button class="btn btn-primary" data-action="open-day-closing">Fazer fechamento agora →</button>
            </div>
          `;
          app.insertBefore(card, app.firstChild);
        }
      }

      if (page === 'settings') {
        const app = $('app');
        if (app) app.insertAdjacentHTML('beforeend', panelWhatsApp());
      }
    } else {
      if (existingBtn) existingBtn.remove();
      const card = document.getElementById('card-fechamento-dia');
      if (card) card.remove();
    }
  };

  try {
    render = customRender;
  } catch {
    window.render = customRender;
  }

  // Verifica parâmetro na URL: ?fechamento=YYYY-MM-DD ou ?fechamento=hoje
  function checkUrlTriggers() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('fechamento')) {
        const val = urlParams.get('fechamento');
        const target = val === 'hoje' || !val ? today() : val;
        setTimeout(() => {
          if (isAdmin()) openDayClosingModal(target);
        }, 500);
      }
    } catch {}
  }

  // Event Listeners
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;

    if (action === 'open-day-closing') {
      openDayClosingModal();
    } else if (action === 'save-day-closing') {
      saveDayClosing(b.dataset.date);
    } else if (action === 'send-morning-whatsapp') {
      sendWhatsApp(generateMorningSummary());
    } else if (action === 'send-night-whatsapp') {
      sendWhatsApp(generateNightSummary());
    } else if (action === 'save-whatsapp') {
      const phone = ($('wa-phone')?.value || '').trim().replace(/\D/g, '');
      const apiKey = ($('wa-key')?.value || '').trim();
      if (!phone) {
        notify('Preencha seu número e chave API.');
        return;
      }
      setWhatsAppConfig({phone,...(apiKey?{apiKey}:{})});
      notify('Configurações salvas!');
    }
  });

  // Exportações
  window.WhatsAppNotify = {
    isAdmin,
    openDayClosingModal,
    sendMorningSummary: () => sendWhatsApp(generateMorningSummary()),
    sendNightSummary: () => sendWhatsApp(generateNightSummary())
  };

  // Verifica gatilho de URL inicial
  setTimeout(checkUrlTriggers, 600);
})();
