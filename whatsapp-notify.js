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
    const todayEvents = events().filter(x => x.date === todayStr && x.type !== 'free');
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

    const todayEvents = events().filter(x => x.date === todayStr && !['free', 'break'].includes(x.type));

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

  function isLessonItem(x) {
    return Boolean(x && x.title && /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') && !['study', 'review', 'free', 'break', 'exam'].includes(x.type));
  }

  function defaultClosingDate() {
    window.ClassStatusTracker?.syncUnvotedPastClasses?.();
    const todayStr = today();
    const allLessons = events().filter(isLessonItem);
    const todayLessons = allLessons.filter(x => x.date === todayStr);
    const trackedList = window.ClassStatusTracker?.getTrackedClasses?.() || [];
    const autoMissedDates = [...new Set(trackedList.filter(x => x.status === 'missed' && x.autoMissed && x.date).map(x => x.date))].sort();
    if (!todayLessons.length && autoMissedDates.length) {
      return autoMissedDates[autoMissedDates.length - 1];
    }
    if (!todayLessons.length) {
      const pastDates = [...new Set(allLessons.filter(x => x.date <= todayStr).map(x => x.date))].sort();
      if (pastDates.length) return pastDates[pastDates.length - 1];
    }
    return todayStr;
  }

  // MODAL INTERATIVO: Processo inverso de Fechamento do Dia
  function openDayClosingModal(targetDate) {
    if (!isAdmin()) return;
    window.ClassStatusTracker?.syncUnvotedPastClasses?.();
    const dateStr = targetDate || defaultClosingDate();
    const formatted = fmt(dateStr, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    const allLessons = events().filter(isLessonItem);
    const dayClasses = allLessons.filter(x => x.date === dateStr);
    const dayTasks = data.tasks.filter(x => !x.done || x.date === dateStr);
    const trackedList = window.ClassStatusTracker?.getTrackedClasses?.() || [];

    const recentClassDates = [...new Set([today(), ...allLessons.filter(x => x.date <= today()).map(x => x.date)])]
      .sort((a, b) => b.localeCompare(a))
      .slice(0, 5);
    const datePillsHTML = recentClassDates.length > 1 ? (
      '<div class="pill-row" style="margin-bottom:14px;flex-wrap:wrap;gap:6px">' +
      '<span class="tiny muted">Atalhos:</span>' +
      recentClassDates.map(d => {
        const isCurrent = d === dateStr;
        const autoCount = trackedList.filter(x => x.date === d && x.status === 'missed' && x.autoMissed).length;
        const label = (d === today() ? 'Hoje (' + fmt(d) + ')' : fmt(d, { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })) +
          (autoCount ? ' · 🔴 ' + autoCount + ' sem voto' : '');
        return '<button type="button" class="btn btn-small' + (isCurrent ? ' btn-primary' : '') + '" data-action="open-day-closing" data-date="' + esc(d) + '">' + esc(label) + '</button>';
      }).join('') +
      '</div>'
    ) : '';

    const dayAutoMissed = trackedList.filter(x => x.date === dateStr && x.status === 'missed' && x.autoMissed);
    const autoBannerHTML = dayAutoMissed.length ? (
      '<div style="margin-bottom:14px;padding:10px 12px;border-radius:10px;border:1px solid rgba(239,68,68,0.45);background:rgba(239,68,68,0.06);font-size:12.5px">' +
        '<strong>🔴 Marcadas automaticamente como Não Vistas (' + dayAutoMissed.length + ')</strong>' +
        '<p class="tiny muted" style="margin:4px 0 0">Como você não votou até o fim de <b>' + fmt(dateStr) + '</b>, estas aulas entraram automaticamente em <b>Não vista</b>. Se você assistiu ou quer mudar a classificação, ajuste abaixo e clique em Confirmar.</p>' +
      '</div>'
    ) : '';

    let classesHTML = '';
    if (dayClasses.length === 0) {
      classesHTML = '<div class="empty">Nenhuma aula cadastrada nesta data no cronograma. Use os atalhos acima para revisar a sexta-feira ou outra data.</div>';
    } else {
      classesHTML = dayClasses.map((item, idx) => {
        const timeStr = item.from ? `[${item.from}${item.to ? ' - ' + item.to : ''}] ` : '';
        const prof = item.professor ? ` · ${esc(item.professor)}` : '';
        const existingEntry = trackedList.find(x =>
          (item.id && (x.eventId === item.id || x.id === 'eval-' + item.id)) ||
          (x.topic === item.title && x.date === dateStr)
        );
        const existingVote = existingEntry?.status || 'review';
        const selectedVote = ['review', 'learn', 'missed'].includes(existingVote) ? existingVote : 'review';
        const autoTag = existingEntry?.autoMissed
          ? '<span class="status-badge missed" style="display:inline-block;margin-bottom:8px;font-size:11px">🔴 Não vista (automático · sem voto no dia)</span>'
          : '';
        return `
          <div class="closing-card" data-closing-class="${idx}" data-event-id="${esc(item.id)}" data-event-type="${esc(item.type)}" data-title="${esc(item.title)}" data-subject="${esc(item.subject || 'UC2')}" data-from="${esc(item.from || '')}" data-to="${esc(item.to || '')}" data-prof="${esc(item.professor || '')}">
            ${autoTag}
            <strong style="display:block">${timeStr}${esc(item.title)}</strong>
            <small class="muted" style="display:block;margin:3px 0 10px">${esc(item.subject || 'UC2')}${prof}</small>
            <div class="pill-row">
              <label class="status-pill review">
                <input type="radio" name="class-status-${idx}" value="review" ${selectedVote === 'review' ? 'checked' : ''}>
                <span>🟢 Vista → Revisão</span>
              </label>
              <label class="status-pill learn">
                <input type="radio" name="class-status-${idx}" value="learn" ${selectedVote === 'learn' ? 'checked' : ''}>
                <span>🟡 Vista → Aprender</span>
              </label>
              <label class="status-pill missed">
                <input type="radio" name="class-status-${idx}" value="missed" ${selectedVote === 'missed' ? 'checked' : ''}>
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
        <div class="pill-row between" style="align-items:flex-end;gap:12px;margin-bottom:6px">
          <h2 id="closing-title" style="margin:0">Fechamento · ${formatted}</h2>
          <label class="field-label" style="margin:0;min-width:155px">Data do fechamento
            <input type="date" id="closing-date-picker" class="field" value="${esc(dateStr)}">
          </label>
        </div>
        <p class="muted" style="margin-bottom:12px">Confirme o que você assistiu e concluiu para calibrar suas revisões automáticas no MedReview e Planejamento.</p>
        ${datePillsHTML}
        ${autoBannerHTML}

        <h3 style="font-size:13px;margin:10px 0 8px;font-weight:750">Aulas e Tutorias da Data</h3>
        ${classesHTML}
        ${tasksHTML}

        <div style="margin-top:18px">
          <label class="field-label">Reflexão do dia (opcional)
            <textarea id="closing-daily-note" class="field" rows="3" placeholder="O que funcionou bem? O que precisa de ajuste amanhã?">${esc(data.notes.find(x => x.date === dateStr)?.text || '')}</textarea>
          </label>
        </div>

        <div class="pill-row between" style="margin-top:22px">
          <button type="button" class="btn" data-action="close">Cancelar</button>
          <button type="button" class="btn btn-primary" data-action="save-day-closing" data-date="${esc(dateStr)}">✓ Confirmar e Gerar Revisões</button>
        </div>
      </div>
    `;
    $('modal').classList.remove('hidden');
  }

  // Salva o fechamento do dia e executa as ações automáticas
  function saveDayClosing(targetDate) {
    if (!isAdmin()) return;
    const dateStr = targetDate || $('closing-date-picker')?.value || today();
    const classCards = document.querySelectorAll('[data-closing-class]');

    let reviewsCreated = 0;
    let tasksCreated = 0;

    classCards.forEach(card => {
      const idx = card.dataset.closingClass;
      const eventId = card.dataset.eventId || '';
      const eventType = card.dataset.eventType || 'class';
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
        let found = trackerList.find(x =>
          (eventId && (x.eventId === eventId || x.id === 'eval-' + eventId)) ||
          (x.topic === title && x.date === dateStr)
        );
        if (!found) {
          trackerList.push({
            id: eventId ? 'eval-' + eventId : uid(),
            eventId,
            eventType,
            topic: title,
            subject,
            date: dateStr,
            minutes: duration,
            professor: card.dataset.prof || '',
            status,
            autoMissed: false,
            votedAt: new Date().toISOString(),
            masteredAt: null
          });
        } else {
          found.status = status;
          found.autoMissed = false;
          if (eventId && !found.eventId) found.eventId = eventId;
          if (eventType && !found.eventType) found.eventType = eventType;
          found.votedAt = new Date().toISOString();
          if (status !== 'mastered') found.masteredAt = null;
        }
        window.ClassStatusTracker.saveTrackedClasses(trackerList);
      }

      const followupFields = status === 'learn' ? {title: `Aprender / Aprofundar: ${title}`, date: dayAdd(dateStr, 2), estimate: 90} : status === 'missed' ? {title: `Repor aula não assistida: ${title}`, date: dayAdd(dateStr, 3), estimate: 60} : null;
      const reusedTask = followupFields && window.PlanningClassTasks?.followup(data, {id: eventId, type: eventType, title, subject, date: dateStr}, followupFields, dateStr);
      if (reusedTask) tasksCreated++;

      if (status === 'review') {
        // 1. Vista e direcionada para revisão (evita duplicar se já fechou a mesma aula na mesma data)
        let existingSession = data.sessions.find(s => s.topic === title && s.date === dateStr && s.origin === 'closing');
        const sessionId = existingSession ? existingSession.id : uid();
        if (!existingSession) {
          data.sessions.push({
            id: sessionId,
            subject,
            topic: title,
            date: dateStr,
            minutes: duration,
            questions: '',
            correct: '',
            origin: 'closing',
            evaluationStatus: 'review'
          });
        }

        // Gera revisões com espaçamento inteligente respeitando a configuração do usuário
        const configuredIntervals = typeof reviewIntervals === 'function' ? reviewIntervals() : [];
        const uniqueIntervals = [...new Set(configuredIntervals.length ? configuredIntervals : [1, 7, 30])];

        for (const n of uniqueIntervals) {
          const due = dayAdd(dateStr, n);
          const alreadyExists = data.reviews.some(r => r.topic === title && r.due === due && r.interval === n);
          if (!alreadyExists) {
            data.reviews.push({
              id: uid(),
              sessionId,
              subject,
              topic: title,
              due,
              interval: n,
              done: false
            });
            reviewsCreated++;
          }
        }
      } else if (status === 'learn' && !reusedTask) {
        // 2. Vista e necessidade de aprender:
        data.tasks.push({
          id: uid(),
          title: `Aprender / Aprofundar: ${title}`,
          subject,
          date: dayAdd(dateStr, 2),
          priority: window.PlanningClassTasks?.enabled(data) ? PlanningClassTasks.priorityFor({subject, title}) : '3',
          estimate: 90,
          done: false
        });
        tasksCreated++;
      } else if (status === 'missed' && !reusedTask) {
        // 3. Não vista:
        data.tasks.push({
          id: uid(),
          title: `Repor aula não assistida: ${title}`,
          subject,
          date: dayAdd(dateStr, 3),
          priority: window.PlanningClassTasks?.enabled(data) ? PlanningClassTasks.priorityFor({subject, title}) : '2',
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
          const trackedList = Array.isArray(data.settings?.evaluatedClasses) ? data.settings.evaluatedClasses : [];
          const autoMissed = trackedList.filter(x => x.status === 'missed' && x.autoMissed);
          const latestAutoDate = autoMissed.reduce((m, x) => (x.date && x.date > m ? x.date : m), '');
          const card = document.createElement('div');
          card.id = 'card-fechamento-dia';
          card.className = 'panel';
          card.style.borderColor = autoMissed.length ? 'rgba(239, 68, 68, 0.45)' : 'rgba(37, 211, 102, 0.4)';
          card.innerHTML = autoMissed.length ? `
            <div class="pill-row between" style="flex-wrap:wrap;gap:12px">
              <div>
                <strong>🔴 ${autoMissed.length} ${autoMissed.length === 1 ? 'aula de ' + fmt(latestAutoDate) + ' foi para Não Vistas' : 'aulas de ' + fmt(latestAutoDate) + ' foram para Não Vistas'} (sem voto)</strong>
                <p class="tiny muted" style="margin:2px 0 0">Como não houve votação no fechamento de ${fmt(latestAutoDate)}, elas entraram automaticamente em <b>Não Vistas</b>. Você pode revisar e alterar os votos quando quiser.</p>
              </div>
              <div class="pill-row">
                <button class="btn btn-small" data-action="open-aulas-missed">Ver em Não Vistas</button>
                <button class="btn btn-primary" data-action="open-day-closing" data-date="${esc(latestAutoDate)}">Revisar ${fmt(latestAutoDate)} →</button>
              </div>
            </div>
          ` : `
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
      openDayClosingModal(b.dataset.date);
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

  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'closing-date-picker' && e.target.value) {
      openDayClosingModal(e.target.value);
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
