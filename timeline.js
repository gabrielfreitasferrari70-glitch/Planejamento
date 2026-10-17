/* Planejamento Medicina 2.0 — Linha do Tempo Interativa com Camadas e Zoom Progressivo
   Eixo horizontal em dias, faixas de fases, carga planejada, marcos, zoom progressivo,
   status tripartido (Planejado/Realizado/Sugerido) e conexões de continuidade. */
'use strict';

(function(){
  // Estado local da Linha do Tempo
  let zoomLevel = 'weeks'; // 'general' | 'weeks' | 'days'
  let activeFilter = 'all'; // 'all' | 'class' | 'tutorial' | 'community' | 'exam' | 'study' | 'pending'
  let selectedDate = today();
  let selectedActivityId = null;

  const norm = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const equals = (a, b) => norm(a) === norm(b);

  // Registrar na navegação principal (MENU)
  const calIdx = MENU.findIndex(x => x[0] === 'calendar');
  if (calIdx >= 0 && !MENU.some(x => x[0] === 'timeline')) {
    MENU.splice(calIdx + 1, 0, ['timeline', 'timeline', 'Linha do Tempo']);
  }

  // Chaves de sincronização
  function ensureTimelineMeta() {
    if (!data.settings.timelineActivityMeta) data.settings.timelineActivityMeta = {};
  }

  // 1. Detecção e Cálculo de Fases do Planejamento (Faixas de Duração)
  function getPhases(allEvents) {
    if (Array.isArray(data.settings.timelinePhases) && data.settings.timelinePhases.length) {
      return data.settings.timelinePhases;
    }
    const dates = [...new Set(allEvents.map(x => x.date).filter(Boolean))].sort();
    if (!dates.length) return [];
    const minDate = dates[0], maxDate = dates[dates.length - 1];

    // Detectar marcos de avaliação principais (ex.: AVALIAÇÃO 1º MÓDULO, AVALIAÇÃO 2º MÓDULO, PROVA FINAL)
    const exams = allEvents.filter(x => x.type === 'exam' || /avaliação|módulo|prova final/i.test(x.title)).sort((a,b) => a.date.localeCompare(b.date));
    const m1 = exams.find(x => /1º módulo|primeiro módulo/i.test(x.title))?.date || '2026-10-13';
    const m2 = exams.find(x => /2º módulo|segundo módulo/i.test(x.title))?.date || '2026-12-08';

    if (minDate <= m1 && maxDate >= m2) {
      return [
        {
          id: 'phase-1',
          name: '1º Módulo · Cardiovascular e Respiratório',
          from: minDate,
          to: m1,
          color: '#5869c5',
          bg: '#eef1fa'
        },
        {
          id: 'phase-2',
          name: '2º Módulo · Sistemas Urinário, Reprodutor e Digestório',
          from: dayAdd(m1, 1),
          to: m2,
          color: '#269a82',
          bg: '#e8f6ef'
        },
        {
          id: 'phase-3',
          name: 'Consolidação e Prova Final',
          from: dayAdd(m2, 1),
          to: maxDate,
          color: '#ad7839',
          bg: '#fff8ec'
        }
      ];
    }

    // Fallback: divide em ciclos de 4 semanas
    const phases = [];
    let cur = minDate, idx = 1;
    while (cur < maxDate) {
      let next = dayAdd(cur, 27);
      if (next > maxDate) next = maxDate;
      phases.push({
        id: 'phase-' + idx,
        name: 'Ciclo de Aprendizagem ' + idx,
        from: cur,
        to: next,
        color: idx % 2 === 1 ? '#5869c5' : '#269a82',
        bg: idx % 2 === 1 ? '#eef1fa' : '#e8f6ef'
      });
      cur = dayAdd(next, 1);
      idx++;
    }
    return phases;
  }

  // 2. Auxiliares de Carga Horária e Status
  function getActivityMeta(id) {
    ensureTimelineMeta();
    return data.settings.timelineActivityMeta[id] || {};
  }

  function getActivityStatus(x) {
    const meta = getActivityMeta(x.id);
    if (meta.status) return meta.status; // 'planned' | 'in_progress' | 'completed'
    // Verificar se já houve sessão de estudo correspondente
    const hasSession = (data.sessions || []).some(s => s.date === x.date && (equals(s.topic, x.title) || equals(s.subject, x.subject)));
    if (hasSession) return 'completed';
    // Verificar se é tarefa concluída
    if (x.origin === 'planned' && data.tasks.some(t => t.id === x.id.replace('schedule-','') && t.done)) return 'completed';
    if (x.origin === 'review' && data.reviews.some(r => r.id === x.id && r.done)) return 'completed';
    if (x.origin === 'suggested') return 'suggested';
    return 'planned';
  }

  function getActivityDuration(x) {
    const meta = getActivityMeta(x.id);
    if (meta.customDuration) return meta.customDuration;
    if (x.from && x.to) {
      const diff = mins(x.to) - mins(x.from);
      if (diff > 0) return diff;
    }
    return 120; // default 2h se não especificado
  }

  // 3. Regras de Desdobramentos (Sugerido / Realizado)
  function getRuleFollowups(x) {
    const followups = [];
    const t = today();
    const isPast = x.date <= t;

    // Regra 1: Revisões Espaçadas (MedReview) para aulas e tutorias
    const hasReview = (data.reviews || []).some(r => equals(r.topic, x.title) || r.topic?.includes(x.title.slice(0, 20)));
    followups.push({
      type: 'review',
      label: 'Agendar Revisão Ativa (1D, 7D, 30D no MedReview)',
      description: 'Cria cartões de revisão espaçada na agenda do MedReview a partir desta data.',
      applied: hasReview,
      icon: 'reviews',
      action: 'timeline-rule-review'
    });

    // Regra 2: Conexão com Próxima Prova / Radar
    const nextExamItem = (events().filter(e => e.type === 'exam' && e.date >= x.date && (equals(e.subject, x.subject) || !x.subject || x.subject === 'UC2')))[0];
    if (nextExamItem) {
      const scopeKey = nextExamItem.date + '|' + (nextExamItem.subject || 'UC2') + '|' + nextExamItem.title;
      const inRadar = (data.examScopes?.[scopeKey] || []).some(sc => equals(sc.topic, x.title));
      followups.push({
        type: 'radar',
        label: 'Vincular ao Radar da Prova: ' + displayTitle(nextExamItem.title),
        description: inRadar ? 'Este tema já está cadastrado no radar da prova.' : 'Inclui este assunto no mapa de conteúdos cobrados na prova.',
        applied: inRadar,
        examId: nextExamItem.id,
        icon: 'radar',
        action: 'timeline-rule-radar'
      });
    }

    // Regra 3: Registrar Sessão de Estudo Realizada
    const hasSession = (data.sessions || []).some(s => s.date === x.date && equals(s.topic, x.title));
    followups.push({
      type: 'study',
      label: 'Registrar Estudo / Questões Realizadas',
      description: hasSession ? 'Sessão já registrada no seu histórico de estudos.' : 'Registra tempo de estudo efetivo no seu painel de desempenho.',
      applied: hasSession,
      icon: 'studies',
      action: 'timeline-rule-study'
    });

    // Regra 4: Tarefa de Próximo Passo
    const hasTask = (data.tasks || []).some(tk => tk.title?.includes(x.title.slice(0, 25)));
    followups.push({
      type: 'task',
      label: 'Criar Tarefa de Fechamento / Próximo Passo',
      description: 'Adiciona uma tarefa para resumir ou aprofundar os pontos-chave.',
      applied: hasTask,
      icon: 'plus',
      action: 'timeline-rule-task'
    });

    return followups;
  }

  // 4. Cadeia de Conexões ("Como essa atividade se conecta ao que vem depois")
  function getContinuityChain(x, allEvents) {
    const sameSubject = allEvents.filter(e => e.id !== x.id && e.subject && equals(e.subject, x.subject)).sort((a,b) => a.date.localeCompare(b.date));
    const previous = sameSubject.filter(e => e.date < x.date).pop();
    const next = sameSubject.filter(e => e.date > x.date)[0];
    const exam = allEvents.filter(e => e.type === 'exam' && e.date >= x.date && (equals(e.subject, x.subject) || e.subject === 'UC2'))[0];
    return { previous, current: x, next, exam };
  }

  // 5. Renderização Principal da Linha do Tempo
  function timelineView() {
    const all = events();
    if (!all.length) {
      return panel('Linha do Tempo Interativa', empty('Nenhum evento no cronograma. Importe sua grade ou adicione compromissos para visualizar a linha do tempo.'));
    }

    const t = today();
    const dates = [...new Set(all.map(x => x.date).filter(Boolean))].sort();
    const minDate = dates[0] || t;
    const maxDate = dates[dates.length - 1] || t;

    // Obter Fases
    const phases = getPhases(all);
    const activePhase = phases.find(p => t >= p.from && t <= p.to) || (t < minDate ? phases[0] : phases[phases.length - 1]);

    // Calcular Carga e Progresso
    const totalDays = Math.max(1, Math.round((Date.parse(maxDate + 'T12:00:00Z') - Date.parse(minDate + 'T12:00:00Z')) / 86400000) + 1);
    const passedDays = Math.max(0, Math.min(totalDays, Math.round((Date.parse(t + 'T12:00:00Z') - Date.parse(minDate + 'T12:00:00Z')) / 86400000) + 1));
    const progressPct = Math.round((passedDays / totalDays) * 100);

    // Próxima Avaliação
    const upcomingExams = all.filter(x => x.type === 'exam' && x.date >= t).sort((a,b) => a.date.localeCompare(b.date));
    const nextExam = upcomingExams[0];
    const daysToExam = nextExam ? Math.round((Date.parse(nextExam.date + 'T12:00:00Z') - Date.parse(t + 'T12:00:00Z')) / 86400000) : null;

    // Configuração de Largura por Dia conforme Zoom
    const dayWidth = zoomLevel === 'general' ? 28 : (zoomLevel === 'weeks' ? 88 : 200);
    const canvasWidth = totalDays * dayWidth;

    // Cabeçalho de Posicionamento ("Onde estou no planejamento")
    const heroHTML = `
      <section class="timeline-hero">
        <div class="timeline-hero-main">
          <div class="timeline-position-card">
            <div class="timeline-position-badge">
              <span class="pulse"></span>
              <span>Você está aqui · ${fmt(t, { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' })}</span>
            </div>
            <h2>${esc(activePhase?.name || 'Semestre Acadêmico')}</h2>
            <div class="timeline-progress-track">
              <div class="timeline-progress-bar">
                <div class="timeline-progress-fill" style="width: ${progressPct}%"></div>
              </div>
              <div class="timeline-progress-labels">
                <span>Dia ${passedDays} de ${totalDays} (${progressPct}% do cronograma percorrido)</span>
                <span>Fim: ${fmt(maxDate, { day: '2-digit', month: 'short', timeZone: 'UTC' })}</span>
              </div>
            </div>
          </div>
          <div class="timeline-milestone-card">
            <div class="timeline-milestone-icon">${ico('trophy')}</div>
            <div class="timeline-milestone-info">
              <small class="muted">Próximo Marco Avaliativo</small>
              <strong>${nextExam ? esc(displayTitle(nextExam.title)) : 'Nenhuma prova agendada'}</strong>
              <p>${nextExam ? (daysToExam === 0 ? 'Hoje!' : daysToExam === 1 ? 'Amanhã!' : 'Em ' + daysToExam + ' dias (' + fmt(nextExam.date) + ')') : 'Semestre concluído com sucesso'}</p>
            </div>
          </div>
        </div>

        <div class="timeline-toolbar">
          <div class="timeline-toolbar-group">
            <span class="tiny muted" style="font-weight:700">ZOOM PROGRESSIVO:</span>
            <div class="timeline-zoom-controls" role="group" aria-label="Controle de Zoom">
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='general'?'active':''}" data-action="timeline-zoom" data-zoom="general">Geral (Semestre)</button>
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='weeks'?'active':''}" data-action="timeline-zoom" data-zoom="weeks">Semanas (Médio)</button>
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='days'?'active':''}" data-action="timeline-zoom" data-zoom="days">Dias (Detalhado)</button>
            </div>
            ${btn(ico('target') + ' Ir para Hoje', 'timeline-scroll-today', '', 'btn btn-small')}
            ${btn(ico('list') + ' Ver em Lista', 'timeline-view-list', '', 'btn btn-small')}
          </div>

          <div class="timeline-toolbar-group">
            <div class="timeline-filters-bar" role="group" aria-label="Filtro de Atividades">
              <button type="button" class="timeline-filter-chip ${activeFilter==='all'?'active':''}" data-action="timeline-filter" data-filter="all">Todas</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='class'?'active':''}" data-action="timeline-filter" data-filter="class">Aulas</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='tutorial'?'active':''}" data-action="timeline-filter" data-filter="tutorial">Tutorias</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='exam'?'active':''}" data-action="timeline-filter" data-filter="exam">Avaliações</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='study'?'active':''}" data-action="timeline-filter" data-filter="study">Estudos / Revisões</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='pending'?'active':''}" data-action="timeline-filter" data-filter="pending">Apenas Pendentes</button>
            </div>
          </div>
        </div>
      </section>
    `;

    // Gerar Mapa de Dias e Carga
    const dayMap = {};
    for (let i = 0; i < totalDays; i++) {
      const d = dayAdd(minDate, i);
      dayMap[d] = {
        date: d,
        index: i,
        events: all.filter(x => x.date === d),
        left: i * dayWidth,
        width: dayWidth
      };
    }

    // Filtrar Atividades Visíveis
    const filterFn = x => {
      if (activeFilter === 'all') return true;
      if (activeFilter === 'pending') return getActivityStatus(x) !== 'completed';
      return x.type === activeFilter;
    };

    // Montar Camada 1: Faixas de Duração das Fases
    const phaseBandsHTML = phases.map(p => {
      const startIdx = Math.max(0, Math.round((Date.parse(p.from + 'T12:00:00Z') - Date.parse(minDate + 'T12:00:00Z')) / 86400000));
      const endIdx = Math.min(totalDays - 1, Math.round((Date.parse(p.to + 'T12:00:00Z') - Date.parse(minDate + 'T12:00:00Z')) / 86400000));
      const pLeft = startIdx * dayWidth;
      const pWidth = Math.max(dayWidth, (endIdx - startIdx + 1) * dayWidth - 4);
      const isCurrent = t >= p.from && t <= p.to;

      return `
        <div class="timeline-phase-band" style="left:${pLeft}px;width:${pWidth}px;background:${p.bg};border-color:${p.color};color:${p.color}" title="${esc(p.name)} (${fmt(p.from)} a ${fmt(p.to)})" data-action="timeline-phase-click" data-from="${p.from}">
          <strong>${esc(p.name)}</strong>
          <span class="phase-badge">${isCurrent ? 'Fase Atual' : fmt(p.from) + ' – ' + fmt(p.to)}</span>
        </div>
      `;
    }).join('');

    // Montar Camada 2: Carga Horária Planejada (Histograma)
    const loadBarsHTML = Object.values(dayMap).map(day => {
      let totalMins = 0;
      day.events.forEach(e => totalMins += getActivityDuration(e));
      const hrs = (totalMins / 60).toFixed(1);
      const intensity = totalMins === 0 ? 'none' : totalMins < 180 ? 'light' : (totalMins <= 360 ? 'moderate' : 'heavy');
      if (totalMins === 0) return '';

      return `
        <div class="timeline-day-load-col" style="left:${day.left}px;width:${day.width}px" title="${fmt(day.date)}: ${hrs}h planejadas (${day.events.length} atividades)">
          <div class="timeline-load-bar ${intensity}"></div>
        </div>
      `;
    }).join('');

    // Montar Camada 3: Régua de Datas e Dias
    const rulerColsHTML = Object.values(dayMap).map(day => {
      const isToday = day.date === t;
      const isSelected = day.date === selectedDate;
      const dayNum = Number(day.date.slice(8));
      const weekday = fmt(day.date, { weekday: 'short', timeZone: 'UTC' }).replace('.', '');

      return `
        <div class="timeline-ruler-col ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" style="left:${day.left}px;width:${day.width}px" data-action="timeline-select-day" data-date="${day.date}">
          <strong>${dayNum}</strong>
          <small>${esc(weekday)}</small>
        </div>
      `;
    }).join('');

    // Marcador de Hoje Vertical
    const todayIndex = dayMap[t]?.index;
    const todayMarkerHTML = todayIndex !== undefined ? `
      <div class="timeline-today-marker" style="left:${todayIndex * dayWidth + dayWidth/2}px">
        <div class="timeline-today-flag">Hoje</div>
      </div>
    ` : '';

    // Montar Camada 4: Trilhas de Atividades (Swimlanes)
    const lanes = [
      { id: 'class', title: 'Aulas & Práticas', icon: 'studies', types: ['class', 'welcome'] },
      { id: 'tutorial', title: 'Tutorias / PBL', icon: 'target', types: ['tutorial'] },
      { id: 'community', title: 'Interação Comunitária', icon: 'cross', types: ['community'] },
      { id: 'exam', title: 'Avaliações & Prazos', icon: 'exams', types: ['exam'] },
      { id: 'study', title: 'Estudos & Revisões', icon: 'reviews', types: ['study', 'review'] }
    ];

    const lanesHTML = lanes.map(lane => {
      const laneEvents = all.filter(x => lane.types.includes(x.type) && filterFn(x));
      const dayCounts = {};
      laneEvents.forEach(e => {
        dayCounts[e.date] = (dayCounts[e.date] || 0) + 1;
      });
      const maxCount = Math.max(1, ...(Object.values(dayCounts).length ? Object.values(dayCounts) : [1]));
      const laneHeight = Math.max(68, maxCount * 44 + 8);
      const dayIndexMap = {};

      const itemsHTML = laneEvents.map(x => {
        const day = dayMap[x.date];
        if (!day) return '';
        const slotIdx = dayIndexMap[x.date] || 0;
        dayIndexMap[x.date] = slotIdx + 1;

        const status = getActivityStatus(x);
        const statusClass = 'status-' + status;
        const timeLabel = x.from ? (x.to ? x.from + '–' + x.to : x.from) : 'Geral';
        const title = displayTitle(x.title);
        const cardLeft = day.left + 2;
        const cardWidth = Math.max(24, day.width - 4);
        const cardTop = 6 + slotIdx * 42;
        const cardHeight = 36;

        return `
          <button type="button" class="timeline-act-card ${statusClass} ${x.sheetColor ? 'sheet-coded' : ''}" style="left:${cardLeft}px;width:${cardWidth}px;top:${cardTop}px;height:${cardHeight}px" ${sheetStyle(x)} data-action="timeline-activity-click" data-id="${esc(x.id)}" title="${esc(title)} (${timeLabel})">
            <span class="timeline-act-time">${esc(timeLabel)}</span>
            <span class="timeline-act-title">${esc(title)}</span>
            <div class="timeline-act-footer">
              <span class="tag ${status==='completed'?'good':status==='suggested'?'review':'gray'}">${status==='completed'?'✓ Realizado':status==='suggested'?'✨ Sugerido':'Planejado'}</span>
              ${x.professor ? '<span class="tiny muted">' + esc(x.professor.split(' ')[0]) + '</span>' : ''}
            </div>
          </button>
        `;
      }).join('');

      return `
        <div class="timeline-lane" style="min-height:${laneHeight}px">
          <div class="timeline-lane-header">
            ${ico(lane.icon)}
            <span>${esc(lane.title)}</span>
          </div>
          <div class="timeline-lane-items" style="width:${canvasWidth}px;height:${laneHeight}px">
            ${itemsHTML}
          </div>
        </div>
      `;
    }).join('');

    // Painel Foco do Dia ("O que tenho para fazer neste dia")
    const focusDay = dayMap[selectedDate] || dayMap[t] || Object.values(dayMap)[0];
    const dayEvents = focusDay ? focusDay.events : [];
    let dayTotalMins = 0;
    dayEvents.forEach(e => dayTotalMins += getActivityDuration(e));

    const dayCardsHTML = dayEvents.length ? dayEvents.map(x => {
      const status = getActivityStatus(x);
      const isDone = status === 'completed';
      const timeStr = x.from ? (x.to ? x.from + ' – ' + x.to : x.from) : 'Horário livre';

      return `
        <div class="timeline-day-event-card ${isDone ? 'status-completed' : ''}" data-action="timeline-activity-click" data-id="${esc(x.id)}">
          <div class="pill-row between">
            <span class="tiny muted" style="font-weight:700">${esc(timeStr)}</span>
            <span class="tag ${isDone?'good':status==='suggested'?'review':'gray'}">${isDone?'✓ Realizado':status==='suggested'?'✨ Sugerido':'Planejado'}</span>
          </div>
          <strong style="font-size:13px;color:var(--text)">${esc(displayTitle(x.title))}</strong>
          <small class="muted">${esc(displayTitle(x.subject || 'UC2'))} ${x.professor ? '· ' + esc(x.professor) : ''}</small>
          <div class="pill-row" style="margin-top:6px">
            ${btn('Ver Detalhes e Conexões →', 'timeline-activity-click', `data-id="${esc(x.id)}"`, 'btn btn-small')}
            ${btn(isDone ? 'Reabrir' : 'Marcar Realizado', 'timeline-toggle-status', `data-id="${esc(x.id)}"`, 'btn btn-small' + (isDone ? '' : ' btn-primary'))}
          </div>
        </div>
      `;
    }).join('') : empty('Nenhuma atividade ou compromisso agendado para este dia.');

    const dayFocusHTML = `
      <section class="timeline-day-focus" id="timeline-day-focus">
        <div class="timeline-day-focus-head">
          <div>
            <div class="breadcrumb" style="margin-bottom:4px">FOCO DO DIA SELECIONADO</div>
            <h3>${fmt(focusDay?.date || t, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
          </div>
          <div class="pill-row">
            ${tag(dayEvents.length + ' atividades')}
            ${tag((dayTotalMins / 60).toFixed(1) + 'h planejadas')}
            ${btn(ico('plus') + ' Adicionar neste dia', 'create', `data-type="event" data-date="${focusDay?.date || t}"`, 'btn btn-small')}
          </div>
        </div>
        <div class="timeline-day-events-list">
          ${dayCardsHTML}
        </div>
      </section>
    `;

    return `
      <div class="timeline-view zoom-${zoomLevel}">
        ${heroHTML}

        <div class="timeline-scroll-container" id="timeline-scroller">
          <div class="timeline-canvas" style="width:${canvasWidth + 140}px">
            <!-- Camada 1: Faixas de Fases -->
            <div class="timeline-phases-track">
              <div class="timeline-lane-header">${ico('calendar')} Fases</div>
              <div style="position:relative;flex:1">${phaseBandsHTML}</div>
            </div>

            <!-- Camada 2: Carga Horária Planejada -->
            <div class="timeline-load-track">
              <div class="timeline-lane-header">${ico('clock')} Carga</div>
              <div style="position:relative;flex:1">${loadBarsHTML}</div>
            </div>

            <!-- Camada 3: Régua de Datas -->
            <div class="timeline-ruler-track">
              <div class="timeline-lane-header">${ico('target')} Dias</div>
              <div style="position:relative;flex:1">${rulerColsHTML} ${todayMarkerHTML}</div>
            </div>

            <!-- Camada 4: Trilhas de Atividades -->
            <div class="timeline-lanes-body">
              ${lanesHTML}
            </div>
          </div>
        </div>

        ${dayFocusHTML}
      </div>
    `;
  }

  // 6. Modal / Drawer de Detalhes da Atividade e Desdobramentos por Regras
  function showTimelineDetail(id) {
    const all = events();
    const x = all.find(e => e.id === id);
    if (!x) return;

    selectedActivityId = id;
    const meta = getActivityMeta(id);
    const status = getActivityStatus(x);
    const timeStr = x.from ? (x.to ? x.from + ' – ' + x.to : x.from) : 'Sem horário fixo';
    const durationMins = getActivityDuration(x);
    const followups = getRuleFollowups(x);
    const continuity = getContinuityChain(x, all);

    // Sugestão de objetivo inteligente
    const suggestedObjective = meta.objective || (
      x.type === 'exam' ? 'Revisar todo o conteúdo cobrado e realizar a prova com foco e atenção.' :
      x.type === 'tutorial' ? 'Analisar o caso clínico, formular hipóteses diagnósticas e integrar os mecanismos fisiopatológicos.' :
      'Compreender os mecanismos celulares, estruturais e funcionais abordados no tema ' + displayTitle(x.title) + '.'
    );

    const continuityHTML = `
      <div class="timeline-continuity-chain">
        <div class="breadcrumb" style="margin-bottom:0">COMO ESSA ATIVIDADE SE CONECTA AO QUE VEM DEPOIS</div>
        <div class="timeline-continuity-steps">
          <div class="timeline-chain-step">
            <small>⬅️ Anterior no Módulo</small>
            <strong>${continuity.previous ? esc(displayTitle(continuity.previous.title)) : 'Início do módulo'}</strong>
            <span class="tiny muted">${continuity.previous ? fmt(continuity.previous.date) : '—'}</span>
          </div>
          <div class="timeline-chain-step current">
            <small>🎯 Atividade Atual</small>
            <strong>${esc(displayTitle(x.title))}</strong>
            <span class="tiny muted">${fmt(x.date)} (${timeStr})</span>
          </div>
          <div class="timeline-chain-step">
            <small>➡️ Próximo Passo</small>
            <strong>${continuity.next ? esc(displayTitle(continuity.next.title)) : 'Fim do módulo'}</strong>
            <span class="tiny muted">${continuity.next ? fmt(continuity.next.date) : '—'}</span>
          </div>
          <div class="timeline-chain-step">
            <small>🏆 Avaliação Alvo</small>
            <strong>${continuity.exam ? esc(displayTitle(continuity.exam.title)) : 'Nenhuma prova vinculada'}</strong>
            <span class="tiny muted">${continuity.exam ? fmt(continuity.exam.date) : '—'}</span>
          </div>
        </div>
      </div>
    `;

    const followupsHTML = followups.map(f => `
      <div class="pill-row between" style="background:var(--card);border:1px solid var(--border);border-radius:9px;padding:9px 12px">
        <div>
          <strong style="font-size:12px;display:block">${ico(f.icon)} ${esc(f.label)}</strong>
          <span class="tiny muted">${esc(f.description)}</span>
        </div>
        ${btn(f.applied ? '✓ Aplicado' : 'Executar Regra', f.action, `data-id="${esc(x.id)}" data-exam="${f.examId || ''}"`, 'btn btn-small' + (f.applied ? '' : ' btn-primary'))}
      </div>
    `).join('');

    const modalHTML = `
      <div class="modal-card" style="max-width:680px" role="dialog" aria-modal="true">
        <button type="button" class="close" data-action="close" aria-label="Fechar">×</button>
        
        <div class="timeline-modal-detail">
          <div class="timeline-detail-header">
            <div class="timeline-detail-tags">
              <span class="tag gray">${esc(x.type || 'Atividade')}</span>
              <span class="tag" style="background:var(--accentbg);color:var(--accent)">${esc(displayTitle(x.subject || 'UC2'))}</span>
              ${x.sheetColor ? '<span class="tag" style="background:' + x.sheetColor + '33;color:' + x.sheetColor + '">Cor Oficial</span>' : ''}
            </div>
            <h2 style="font-size:20px;margin:6px 0 2px">${esc(displayTitle(x.title))}</h2>
            <p class="muted" style="margin:0">${fmt(x.date, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' })} · ${esc(timeStr)} · Duração Prevista: ${(durationMins/60).toFixed(1)}h</p>
            ${x.professor ? '<p class="professor-detail" style="margin:6px 0 0"><strong>Docente:</strong> ' + esc(x.professor) + '</p>' : ''}
          </div>

          <!-- Seletor de Status Tripartido -->
          <div>
            <label class="field-label">Status da Atividade</label>
            <div class="timeline-status-selector">
              <button type="button" class="timeline-status-btn status-planned ${status==='planned'?'active':''}" data-action="timeline-set-status" data-status="planned" data-id="${esc(x.id)}">
                ${ico('clock')} Planejado
              </button>
              <button type="button" class="timeline-status-btn status-inprogress ${status==='in_progress'?'active':''}" data-action="timeline-set-status" data-status="in_progress" data-id="${esc(x.id)}">
                ${ico('play')} Em Andamento
              </button>
              <button type="button" class="timeline-status-btn status-completed ${status==='completed'?'active':''}" data-action="timeline-set-status" data-status="completed" data-id="${esc(x.id)}">
                ${ico('check')} Realizado
              </button>
            </div>
          </div>

          <!-- Objetivo da Atividade -->
          <div>
            <label class="field-label" for="timeline-act-objective">Objetivo Pedagógico / Meta desta Atividade</label>
            <textarea id="timeline-act-objective" class="field" rows="2" placeholder="O que você precisa aprender ou realizar nesta atividade?">${esc(meta.objective || suggestedObjective)}</textarea>
          </div>

          <!-- Materiais e Roteiros -->
          <div>
            <label class="field-label">Materiais e Recursos de Estudo</label>
            <div class="pill-row" style="margin-bottom:8px">
              ${data.settings.materialsUrl ? '<a href="' + esc(data.settings.materialsUrl) + '" target="_blank" rel="noopener noreferrer" class="btn btn-small">' + ico('materials') + ' Abrir Pasta da Turma no Drive ↗</a>' : ''}
              ${btn(ico('plus') + ' Adicionar Anotação de Material', 'timeline-add-material-prompt', `data-id="${esc(x.id)}"`, 'btn btn-small')}
            </div>
          </div>

          <!-- Anotações Pessoais -->
          <div>
            <label class="field-label" for="timeline-act-notes">Anotações e Registros de Aprendizado</label>
            <textarea id="timeline-act-notes" class="field" rows="3" placeholder="Sua síntese, dúvidas para perguntar na aula ou tópicos prioritários...">${esc(meta.notes || '')}</textarea>
            <div class="pill-row">
              ${btn('Salvar Anotações e Objetivo', 'timeline-save-meta', `data-id="${esc(x.id)}"`, 'btn btn-small btn-primary')}
            </div>
          </div>

          <!-- Conexões de Continuidade -->
          ${continuityHTML}

          <!-- Desdobramentos Definidos por Regras -->
          <div class="timeline-rules-box">
            <h4>${ico('wand')} Desdobramentos Sugeridos por Regras (1 Clique)</h4>
            <div style="display:grid;gap:8px">
              ${followupsHTML}
            </div>
          </div>
        </div>
      </div>
    `;

    $('modal').innerHTML = modalHTML;
    $('modal').classList.remove('hidden');
  }

  // 7. Ações de Regras e Manipulação
  function setActivityStatus(id, newStatus) {
    ensureTimelineMeta();
    if (!data.settings.timelineActivityMeta[id]) data.settings.timelineActivityMeta[id] = {};
    data.settings.timelineActivityMeta[id].status = newStatus;
    if (newStatus === 'completed') {
      data.settings.timelineActivityMeta[id].completedAt = new Date().toISOString();
    } else {
      delete data.settings.timelineActivityMeta[id].completedAt;
    }
    save();
    showTimelineDetail(id);
    render();
    notify(newStatus === 'completed' ? 'Atividade marcada como realizada!' : 'Status atualizado.');
  }

  function saveActivityMeta(id) {
    ensureTimelineMeta();
    if (!data.settings.timelineActivityMeta[id]) data.settings.timelineActivityMeta[id] = {};
    const objEl = $('timeline-act-objective');
    const noteEl = $('timeline-act-notes');
    if (objEl) data.settings.timelineActivityMeta[id].objective = objEl.value.trim();
    if (noteEl) data.settings.timelineActivityMeta[id].notes = noteEl.value.trim();
    save();
    render();
    notify('Objetivo e anotações salvos com sucesso!');
  }

  function applyRuleReview(id) {
    const x = events().find(e => e.id === id);
    if (!x) return;
    const t = today();
    const baseDate = x.date < t ? t : x.date;

    createReview(x.subject || 'UC2', x.title, dayAdd(baseDate, 1), { origin: 'timeline', eventId: id });
    createReview(x.subject || 'UC2', x.title, dayAdd(baseDate, 7), { origin: 'timeline', eventId: id });
    createReview(x.subject || 'UC2', x.title, dayAdd(baseDate, 30), { origin: 'timeline', eventId: id });

    save();
    showTimelineDetail(id);
    render();
    notify('Revisões espaçadas de 1, 7 e 30 dias criadas no seu cronograma!');
  }

  function applyRuleRadar(id, examId) {
    const x = events().find(e => e.id === id);
    if (!x) return;
    const exam = events().find(e => e.id === examId);
    if (!exam) return;

    const sKey = (exam.date || '') + '|' + (exam.subject || 'UC2') + '|' + (exam.title || '');
    if (!data.examScopes) data.examScopes = {};
    if (!data.examScopes[sKey]) data.examScopes[sKey] = [];

    if (!data.examScopes[sKey].some(sc => equals(sc.topic, x.title))) {
      data.examScopes[sKey].push({ topic: x.title.slice(0, 130), subject: (x.subject || 'UC2').slice(0, 90) });
      save();
      showTimelineDetail(id);
      render();
      notify('Tema adicionado ao radar da prova ' + displayTitle(exam.title) + '!');
    }
  }

  function applyRuleStudy(id) {
    const x = events().find(e => e.id === id);
    if (!x) return;
    closeModal();
    openForm('study', {
      subject: x.subject || '',
      topic: x.title,
      minutes: String(getActivityDuration(x)),
      date: x.date || today()
    });
  }

  function applyRuleTask(id) {
    const x = events().find(e => e.id === id);
    if (!x) return;
    closeModal();
    openForm('task', {
      title: 'Fixar e resumir: ' + x.title,
      subject: x.subject || '',
      date: dayAdd(x.date || today(), 1),
      estimate: '45'
    });
  }

  function scrollToToday() {
    const el = $('timeline-scroller');
    if (!el) return;
    const todayMarker = el.querySelector('.timeline-today-marker') || el.querySelector('.is-today');
    if (todayMarker) {
      const targetX = Math.max(0, todayMarker.offsetLeft - (el.clientWidth / 2));
      el.scrollTo({ left: targetX, behavior: 'smooth' });
    }
  }

  function ensureMobileMore() {
    const el = $('mobile-nav');
    if (el && !el.querySelector('[data-action="more-menu"]')) {
      el.insertAdjacentHTML('beforeend', '<button data-action="more-menu" aria-label="Abrir todas as seções"><span class="nav-icon">' + ico('more') + '</span>Mais</button>');
    }
  }

  // 8. Intercepção do Render e Navegação
  const previousRender = render;
  render = function() {
    if (page === 'timeline') {
      nav();
      $('breadcrumb').textContent = 'LINHA DO TEMPO DO CRONOGRAMA';
      $('heading').textContent = 'Linha do Tempo';
      $('subtitle').textContent = 'Visão contínua com camadas, zoom progressivo e rastreamento de desdobramentos.';
      $('app').innerHTML = timelineView();
      renderAcademicStatus();
      ensureMobileMore();
      // Auto-scroll inicial suave para hoje
      setTimeout(scrollToToday, 80);
      return;
    }

    previousRender();
    ensureMobileMore();

    // Se estiver na tela de cronograma do semestre (calendar), inserir botão de alternância no topo
    if (page === 'calendar') {
      const headingPanel = $('app')?.querySelector('.panel');
      if (headingPanel && !headingPanel.querySelector('.timeline-toggle-banner')) {
        const toggleHTML = `
          <div class="timeline-toggle-banner" style="margin-top:14px;padding:12px 14px;background:var(--accentbg);border:1px solid var(--border);border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="display:flex;align-items:center;gap:10px">
              <span style="font-size:20px;color:var(--accent)">${ico('timeline')}</span>
              <div>
                <strong style="font-size:13px;color:var(--text)">Linha do Tempo com Camadas e Zoom</strong>
                <p class="tiny muted" style="margin:2px 0 0">Visualize fases, carga horária planejada, marcos e conexões entre atividades.</p>
              </div>
            </div>
            ${btn('Abrir Linha do Tempo Interativa →', 'navigate', 'data-page="timeline"', 'btn btn-primary')}
          </div>
        `;
        headingPanel.insertAdjacentHTML('beforeend', toggleHTML);
      }
    }
  };

  // 9. Ouvinte de Eventos de Clique
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    const id = b.dataset.id;

    switch (action) {
      case 'timeline-zoom':
        zoomLevel = b.dataset.zoom;
        render();
        break;
      case 'timeline-filter':
        activeFilter = b.dataset.filter;
        render();
        break;
      case 'timeline-scroll-today':
        selectedDate = today();
        scrollToToday();
        const focusSection = $('timeline-day-focus');
        if (focusSection) focusSection.scrollIntoView({ behavior: 'smooth' });
        break;
      case 'timeline-view-list':
        goto('calendar');
        break;
      case 'timeline-select-day':
        selectedDate = b.dataset.date;
        render();
        const fSec = $('timeline-day-focus');
        if (fSec) fSec.scrollIntoView({ behavior: 'smooth' });
        break;
      case 'timeline-phase-click':
        selectedDate = b.dataset.from;
        render();
        scrollToToday();
        break;
      case 'timeline-activity-click':
        showTimelineDetail(id);
        break;
      case 'timeline-toggle-status': {
        const x = events().find(item => item.id === id);
        if (x) {
          const curStatus = getActivityStatus(x);
          setActivityStatus(id, curStatus === 'completed' ? 'planned' : 'completed');
        }
        break;
      }
      case 'timeline-set-status':
        setActivityStatus(id, b.dataset.status);
        break;
      case 'timeline-save-meta':
        saveActivityMeta(id);
        break;
      case 'timeline-rule-review':
        applyRuleReview(id);
        break;
      case 'timeline-rule-radar':
        applyRuleRadar(id, b.dataset.exam);
        break;
      case 'timeline-rule-study':
        applyRuleStudy(id);
        break;
      case 'timeline-rule-task':
        applyRuleTask(id);
        break;
      case 'timeline-add-material-prompt': {
        const link = prompt('Informe a URL ou nome do material de apoio para esta aula:');
        if (link?.trim()) {
          ensureTimelineMeta();
          if (!data.settings.timelineActivityMeta[id]) data.settings.timelineActivityMeta[id] = {};
          const curNotes = data.settings.timelineActivityMeta[id].notes || '';
          data.settings.timelineActivityMeta[id].notes = (curNotes ? curNotes + '\n' : '') + '• Material: ' + link.trim();
          save();
          showTimelineDetail(id);
          notify('Material anotado na atividade.');
        }
        break;
      }
    }
  });

})();
