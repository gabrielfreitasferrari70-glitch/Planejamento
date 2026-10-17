/* Planejamento Medicina 2.0 — Linha do Tempo Interativa com Camadas e Zoom Progressivo
   Eixo horizontal em dias, faixas de fases, carga planejada, marcos, zoom progressivo,
   status tripartido (Planejado/Realizado/Sugerido) e conexões de continuidade. */
'use strict';

(function(){
  // Estado local da Linha do Tempo
  let zoomLevel = 'weeks'; // 'general' | 'weeks' | 'days'
  let searchQuery='', searchIndex=0, preparationExamId='', scopeEditorOpen=false, searchTimer=null;
  let activeFilter = 'all'; // 'all' | 'class' | 'tutorial' | 'community' | 'exam' | 'study' | 'pending'
  let selectedDate = today();
  let selectedActivityId = null;
  let geometry = null;
  let pendingAnchor = null;
  let pendingPixel = null;
  let zoomValue = 60;
  let toolsOpen=false, dayOpen=false;
  const collapsedLanes=new Set();
  let scrollFrame = null;
  let wheelFrame = null, wheelDelta = 0, wheelX = 0;
  const scales = ['general', 'weeks', 'days'];
  const laneColors = {class:'#8490a3', tutorial:'#FFC000', community:'#8DB4E1', exam:'#FBFF44', task:'#dc3545', review:'#8752cf', study:'#517c45'};
  const isTimelineTask=x=>x.origin==='planned'||String(x.id||'').startsWith('schedule-');
  function activityColor(x) {
    if(x.type==='review')return laneColors.review;
    if(isTimelineTask(x))return laneColors.task;
    return /^#[0-9a-f]{6}$/i.test(x.sheetColor||'') ? x.sheetColor : (laneColors[x.type]||laneColors.class);
  }
  const statusLabels = {planned:'Planejado', in_progress:'Em andamento', completed:'Concluído', suggested:'Sugerido'};
  function dateDiff(a,b) { return Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000); }
  function visibleAnchor() {
    const el = $('timeline-scroller');
    return el && geometry ? (el.scrollLeft + (el.clientWidth-geometry.sidebar)/2)/geometry.dayWidth : null;
  }
  function setZoom(value, anchor=visibleAnchor(), pixel=null) {
    zoomValue=Math.max(0,Math.min(100,Number(value)));
    pendingAnchor=anchor;
    pendingPixel=pixel;
    zoomLevel=zoomValue<30?'general':zoomValue<78?'weeks':'days';
    render();
  }
  function changeZoom(level, anchor=visibleAnchor()) {
    if (!scales.includes(level)) return;
    setZoom({general:0,weeks:60,days:100}[level],anchor);
  }
  function focusDate(date, level) {
    selectedDate = date;
    pendingAnchor = geometry ? dateDiff(date, geometry.minDate)+0.5 : null;
    if (level) { zoomLevel=level; zoomValue={general:0,weeks:60,days:100}[level]; }
    render();
  }


  const norm = x => String(x == null ? '' : x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const equals = (a, b) => norm(a) === norm(b);

  const examScopeKey=e=>e.date+'|'+norm(String(e.title||'').trim().slice(0,160));
  function scopeFor(exam) {
    const scopes=data.examScopes||{}, key=examScopeKey(exam);
    return scopes[key] || scopes[exam.date+'|'+(exam.subject||'UC2')+'|'+exam.title] || [];
  }
  function subjectMatches(a,b) { return !a||!b||['uc2','geral'].includes(norm(a))||equals(a,b); }
  function matchesTopic(x,topic) {
    const title=norm(x.title||x.topic), target=norm(topic.topic);
    return !!title&&!!target&&subjectMatches(topic.subject,x.subject)&&(title.includes(target)||target.includes(title));
  }
  function matchesCategory(x) {
    if(activeFilter==='all')return true;
    if(activeFilter==='task')return isTimelineTask(x);
    if(activeFilter==='review')return x.type==='review';
    if(activeFilter==='pending')return getActivityStatus(x)!=='completed';
    return activeFilter==='study'?['study','review'].includes(x.type):activeFilter==='class'?['class','welcome'].includes(x.type):x.type===activeFilter;
  }
  function matchesSearch(x) {
    const text=norm([x.title,x.subject,x.professor,x.date].filter(Boolean).join(' '));
    return norm(searchQuery).split(' ').filter(Boolean).every(word=>text.includes(word));
  }
  function scopeCandidates(exam,all) {
    const previous=all.filter(x=>x.type==='exam'&&x.date<exam.date&&subjectMatches(exam.subject,x.subject)).pop();
    const seen=new Set();
    return all.filter(x=>['class','tutorial','community','study','review'].includes(x.type)&&x.date<=exam.date&&(!previous||x.date>previous.date)&&subjectMatches(exam.subject,x.subject)).filter(x=>{
      const key=norm(x.subject)+'|'+norm(x.title);if(seen.has(key))return false;seen.add(key);return true;
    });
  }
  function preparationHTML(exam,all) {
    if(!exam)return '';
    const topics=scopeFor(exam), candidates=scopeCandidates(exam,all);
    const pending=all.filter(x=>x.type!=='exam'&&x.date>=today()&&x.date<=exam.date&&topics.some(topic=>matchesTopic(x,topic))&&getActivityStatus(x)!=='completed');
    const remaining=Math.max(0,dateDiff(exam.date,today()));
    const studied=topics.filter(topic=>(data.sessions||[]).some(session=>matchesTopic({title:session.topic,subject:session.subject},topic)));
    const availableDays=new Set(pending.filter(x=>['study','review'].includes(x.type)).map(x=>x.date)).size;
    return `<section class="timeline-preparation" aria-label="Preparação para a prova"><div class="timeline-prep-heading"><div><small>ATÉ A PROVA · ${fmt(exam.date)}</small><h3>${esc(displayTitle(exam.title))}</h3></div><button class="btn btn-small" data-action="timeline-prep-exit">Sair deste modo</button></div>
      <div class="timeline-prep-stats"><span><strong>${remaining}</strong> dias até a prova</span><span><strong>${topics.length}</strong> conteúdo${topics.length===1?'':'s'} confirmado${topics.length===1?'':'s'}</span><span><strong>${studied.length}</strong> com estudo registrado</span><span><strong>${pending.length}</strong> atividade${pending.length===1?'':'s'} pendente${pending.length===1?'':'s'}</span></div>
      <p class="tiny muted">${exam.date<today()?'Esta avaliação já passou. ':''}${availableDays} dias com estudo ou revisão agendados até a prova. Consulte Semana para conferir seus horários livres.${topics.length?' A linha do tempo destaca os conteúdos confirmados e a avaliação.':' Confirme os conteúdos abaixo para filtrar a linha do tempo.'}</p>
      <details id="timeline-scope-editor" ${scopeEditorOpen?'open':''}><summary>Conferir e ajustar conteúdos da avaliação</summary>
        <p class="tiny muted">As sugestões usam matéria e datas do cronograma. Marque apenas o que realmente será cobrado. Os conteúdos confirmados também aparecem no Radar de provas.</p>
        <div class="timeline-scope-topics">${topics.map((topic,index)=>`<label><input type="checkbox" checked data-scope-index="${index}" aria-label="Remover ${esc(topic.topic)}"><span>${esc(topic.topic)}<small>${esc(topic.subject||exam.subject||'UC2')} · Confirmado</small></span></label>`).join('')||'<p class="tiny muted">Nenhum conteúdo confirmado.</p>'}</div>
        <form id="timeline-scope-form" class="timeline-scope-form"><label>Assunto<input class="field" name="topic" required maxlength="130" placeholder="Conteúdo cobrado"></label><label>Matéria<input class="field" name="subject" maxlength="90" value="${esc(exam.subject||'UC2')}"></label><button class="btn btn-small" type="submit">Adicionar conteúdo</button></form>
        <div class="timeline-scope-candidates"><strong>Sugestões do cronograma</strong>${candidates.filter(x=>!topics.some(topic=>matchesTopic(x,topic))).map(x=>`<label><input type="checkbox" data-scope-event="${esc(x.id)}"><span>${esc(displayTitle(x.title))}<small>${fmt(x.date)} · ${esc(x.subject||'UC2')} · Sugestão</small></span></label>`).join('')||'<p class="tiny muted">Nenhuma outra sugestão neste período. Você pode adicionar um assunto acima.</p>'}</div>
      </details></section>`;
  }
  function addScopeTopic(exam,topic,subject) {
    const existing=scopeFor(exam);
    if(existing.some(x=>equals(x.topic,topic)&&equals(x.subject,subject)))return;
    data.examScopes ||= {};
    data.examScopes[examScopeKey(exam)]=[...existing,{topic:String(topic).trim().slice(0,130),subject:String(subject||exam.subject||'UC2').trim().slice(0,90)}];
    save();
  }
  function jumpSearch(direction) {
    const exam=events().find(x=>x.id===preparationExamId);
    const topics=exam?scopeFor(exam):[];
    const matches=events().filter(x=>matchesCategory(x)&&matchesSearch(x)&&(!exam||!topics.length||x.id===exam.id||(x.date<=exam.date&&topics.some(topic=>matchesTopic(x,topic)))));
    if(!matches.length){render();return;}
    searchIndex=(searchIndex+direction+matches.length)%matches.length;
    focusDate(matches[searchIndex].date,'days');
  }

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
    while (cur <= maxDate) {
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
      const scopeKey = examScopeKey(nextExamItem);
      const inRadar = scopeFor(nextExamItem).some(sc => equals(sc.topic, x.title));
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

    // Helper para gerar o cabeçalho uniforme e definido da barra lateral esquerda (dock)
    function makeSidebarHeader(iconName, title, subtitle, count = null, laneId = '') {
      return `<div class="timeline-section-heading" style="width:${Math.max(240,($('app')?.clientWidth||1100)-2)}px"><span class="timeline-section-icon">${ico(iconName)}</span><strong>${esc(title)}</strong>${count > 0 ? `<span class="timeline-section-count">${count} atividades</span>` : ''}${count === 0 ? '<span class="timeline-section-empty">Nenhuma atividade</span>' : ''}${laneId?`<button type="button" class="timeline-lane-toggle" data-action="timeline-lane-toggle" data-lane="${laneId}" aria-expanded="${!collapsedLanes.has(laneId)}" aria-label="${collapsedLanes.has(laneId)?'Expandir':'Recolher'} ${esc(title)}">${collapsedLanes.has(laneId)?'+':'−'}</button>`:''}</div>`;
    }

    // Equal time intervals keep every layer aligned while zoom changes the level of detail.
    const available = Math.max(240, ($('app')?.clientWidth || 1100) - 2);
    const sidebar = 0;
    const usable = available - sidebar;
    const minimum=Math.max(3,usable/totalDays), weekly=Math.max(110,usable/7), daily=Math.max(280,usable/3);
    const dayWidth=zoomValue<=60 ? minimum*Math.pow(weekly/minimum,zoomValue/60) : weekly*Math.pow(daily/weekly,(zoomValue-60)/40);
    zoomLevel=dayWidth<90?'general':dayWidth<220?'weeks':'days';
    const dayMap = {};
    const byDate = new Map();
    all.forEach(x => { if (!byDate.has(x.date)) byDate.set(x.date, []); byDate.get(x.date).push(x); });
    for (let i = 0; i < totalDays; i++) {
      const d = dayAdd(minDate, i);
      const dow = new Date(d + 'T12:00:00Z').getUTCDay();
      dayMap[d] = {date:d, index:i, events:byDate.get(d)||[], left:i*dayWidth, width:dayWidth, isWeekend:dow===0||dow===6};
    }
    const canvasWidth = totalDays * dayWidth;
    geometry = {minDate, totalDays, dayWidth, sidebar, canvasWidth};
    const months = [];
    Object.values(dayMap).forEach(d => {
      const key=d.date.slice(0,7), last=months[months.length-1];
      if (last?.key === key) last.width += dayWidth;
      else months.push({key, date:d.date, left:d.left, width:dayWidth});
    });
    const monthsHTML = months.map(m => `<div class="timeline-month" style="left:${m.left}px;width:${m.width}px">${esc(fmt(m.date,{month:'long',year:'numeric',timeZone:'UTC'}))}</div>`).join('');
    const overviewHTML = `<section class="timeline-overview" aria-label="Navegação do semestre">
      <div class="timeline-overview-heading"><strong>Mapa do semestre</strong><span id="timeline-visible-range"></span></div>
      <div class="timeline-map" id="timeline-map" title="Clique ou arraste para navegar pelo cronograma">
        ${phases.map((p,i)=>`<span class="timeline-map-phase phase-tone-${i%3}" style="left:${Math.max(0,dateDiff(p.from,minDate))/totalDays*100}%;width:${Math.max(0,dateDiff(p.to,p.from)+1)/totalDays*100}%"></span>`).join('')}
        ${all.filter(x=>x.type==='exam').map(x=>`<span class="timeline-map-exam" style="left:${(dateDiff(x.date,minDate)+.5)/totalDays*100}%" title="${esc(displayTitle(x.title))}"></span>`).join('')}
        <span class="timeline-map-window" id="timeline-map-window"></span>
      </div>
      <div class="timeline-overview-dates"><span>${fmt(minDate)}</span><span>Arraste o visor para explorar · duplo clique para aproximar</span><span>${fmt(maxDate)}</span></div>
      <label class="sr-only" for="timeline-position">Posição no cronograma</label><input id="timeline-position" class="timeline-position-range" type="range" min="0" max="1000" value="0" aria-label="Posição no cronograma">
    </section>`;

    // Cabeçalho de Posicionamento ("Onde estou no planejamento")
    const heroHTML = `
      <section class="timeline-hero">
        <div class="timeline-context-row"><span title="${esc(activePhase?.name||'Semestre acadêmico')}">${esc(activePhase?.name||'Semestre acadêmico')}</span><small>${progressPct}% do período · ${fmt(t)}</small>${nextExam?`<button type="button" data-action="timeline-activity-click" data-id="${esc(nextExam.id)}" title="${esc(displayTitle(nextExam.title))}">Próxima prova · ${fmt(nextExam.date)}</button>`:''}</div>
        <div class="timeline-toolbar">
          <div class="timeline-toolbar-group">
            <span class="tiny muted" style="font-weight:700">ESCALA:</span>
            <div class="timeline-zoom-controls" role="group" aria-label="Controle de Zoom">
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='general'?'active':''}" data-action="timeline-zoom" data-zoom="general" aria-pressed="${zoomLevel==='general'}">Semestre</button>
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='weeks'?'active':''}" data-action="timeline-zoom" data-zoom="weeks" aria-pressed="${zoomLevel==='weeks'}">Semana</button>
              <button type="button" class="timeline-zoom-btn ${zoomLevel==='days'?'active':''}" data-action="timeline-zoom" data-zoom="days" aria-pressed="${zoomLevel==='days'}">Dia</button>
            </div>
            <label class="timeline-zoom-range-label">Zoom<input id="timeline-zoom-range" type="range" min="0" max="100" value="${zoomValue}" aria-label="Aproximação do cronograma"></label>
            ${btn('−', 'timeline-zoom-step', 'data-step="-1" aria-label="Diminuir zoom"', 'btn btn-small')}
            ${btn('+', 'timeline-zoom-step', 'data-step="1" aria-label="Aumentar zoom"', 'btn btn-small')}
            ${btn(ico('target') + ' Ir para Hoje', 'timeline-scroll-today', '', 'btn btn-small')}
            ${btn('←', 'timeline-pan', 'data-direction="-1" aria-label="Período anterior"', 'btn btn-small')}
            ${btn('→', 'timeline-pan', 'data-direction="1" aria-label="Próximo período"', 'btn btn-small')}
          </div>

          <div class="timeline-toolbar-group">
            <div class="timeline-filters-bar" role="group" aria-label="Filtro de Atividades">
              <button type="button" class="timeline-filter-chip ${activeFilter==='all'?'active':''}" data-action="timeline-filter" data-filter="all" aria-pressed="${activeFilter==='all'}">Todas</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='class'?'active':''}" data-action="timeline-filter" data-filter="class" aria-pressed="${activeFilter==='class'}">Aulas</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='tutorial'?'active':''}" data-action="timeline-filter" data-filter="tutorial" aria-pressed="${activeFilter==='tutorial'}">Tutorias</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='exam'?'active':''}" data-action="timeline-filter" data-filter="exam" aria-pressed="${activeFilter==='exam'}">Avaliações</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='study'?'active':''}" data-action="timeline-filter" data-filter="study" aria-pressed="${activeFilter==='study'}">Estudos / Revisões</button>
              <button type="button" class="timeline-filter-chip ${activeFilter==='pending'?'active':''}" data-action="timeline-filter" data-filter="pending" aria-pressed="${activeFilter==='pending'}">Apenas Pendentes</button>
            </div>
          </div>
        </div>
      </section>
    `;

    // Filtrar Atividades Visíveis
    const preparationExam=all.find(x=>x.id===preparationExamId&&x.type==='exam');
    const confirmedTopics=preparationExam?scopeFor(preparationExam):[];
    const filterFn = x => {
      if(!matchesSearch(x))return false;
      if(preparationExam&&confirmedTopics.length&&x.id!==preparationExam.id&&!(x.date<=preparationExam.date&&confirmedTopics.some(topic=>matchesTopic(x,topic))))return false;
      return matchesCategory(x);
    };
    const searchMatches=all.filter(filterFn);
    if(searchIndex>=searchMatches.length)searchIndex=0;
    const searchHTML=`<section class="timeline-explorer"><form id="timeline-search-form" role="search"><label for="timeline-search">Localizar no cronograma</label><div class="timeline-search-row"><input class="field" id="timeline-search" type="search" value="${esc(searchQuery)}" placeholder="Assunto, matéria, docente ou data"><button class="btn btn-small" type="submit">Localizar</button>${searchQuery?'<button class="btn btn-small" type="button" data-action="timeline-search-clear">Limpar</button>':''}</div></form><div class="timeline-exam-select"><label for="timeline-prep-exam">Preparar uma avaliação</label><select class="field" id="timeline-prep-exam"><option value="">Selecionar prova…</option>${all.filter(x=>x.type==='exam').map(x=>`<option value="${esc(x.id)}" ${x.id===preparationExamId?'selected':''}>${fmt(x.date)} · ${esc(displayTitle(x.title))}</option>`).join('')}</select></div>${searchQuery?`<div class="timeline-search-status" role="status">${searchMatches.length?`${searchIndex+1} de ${searchMatches.length} resultados`:'Nenhum resultado para esta busca'}<button class="btn btn-small" data-action="timeline-search-prev" ${searchMatches.length?'':'disabled'}>Anterior</button><button class="btn btn-small" data-action="timeline-search-next" ${searchMatches.length?'':'disabled'}>Próximo</button></div>`:''}</section>`;

    // Montar Camada 1: Faixas de Duração das Fases
    const phaseBandsHTML = phases.map((p, phaseIndex) => {
      const startDay = dayMap[p.from] || dayMap[minDate];
      const endDay = dayMap[p.to] || dayMap[maxDate];
      const pLeft = startDay ? startDay.left : 0;
      const pRight = endDay ? (endDay.left + endDay.width) : canvasWidth;
      const pWidth = Math.max(30, pRight - pLeft - 4);
      const isCurrent = t >= p.from && t <= p.to;

      return `
        <button type="button" class="timeline-phase-band phase-tone-${phaseIndex%3}" style="left:${pLeft}px;width:${pWidth}px" title="${esc(p.name)} (${fmt(p.from)} a ${fmt(p.to)})" data-action="timeline-phase-click" data-from="${p.from}" data-to="${p.to}">
          <strong>${esc(p.name)}</strong><span class="phase-badge">${isCurrent ? 'Atual' : fmt(p.from) + ' – ' + fmt(p.to)}</span>
        </button>
      `;
    }).join('');

    // Montar Camada 2: Carga Horária Planejada (Histograma)
    const loadBarsHTML = Object.values(dayMap).map(day => {
      let totalMins = 0;
      day.events.filter(filterFn).forEach(e => totalMins += getActivityDuration(e));
      const hrs = (totalMins / 60).toFixed(1);
      const intensity = totalMins === 0 ? 'none' : totalMins < 180 ? 'light' : (totalMins <= 360 ? 'moderate' : 'heavy');
      if (totalMins === 0) return '';

      return `
        <div class="timeline-day-load-col ${day.isWeekend ? 'is-weekend' : ''}" style="left:${day.left}px;width:${day.width}px" title="${fmt(day.date)}: ${hrs}h planejadas (${day.events.length} atividades)">
          <div class="timeline-load-bar ${intensity}" style="height:${Math.min(100,totalMins/600*100)}%"></div>
        </div>
      `;
    }).join('');

    // Montar Camada 3: Régua de Datas e Dias
    const rulerColsHTML = Object.values(dayMap).map(day => {
      if (zoomLevel === 'general' && day.index !== 0 && new Date(day.date+'T12:00:00Z').getUTCDay() !== 1) return '';
      const isToday = day.date === t;
      const isSelected = day.date === selectedDate;
      const dayNum = Number(day.date.slice(8));
      const weekday = fmt(day.date, { weekday: 'short', timeZone: 'UTC' }).replace('.', '');

      return `
        <button type="button" class="timeline-ruler-col ${day.isWeekend ? 'is-weekend' : ''} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''}" style="left:${day.left}px;width:${day.width}px" data-action="timeline-select-day" data-date="${day.date}" title="${fmt(day.date, { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' })}">
          <strong>${dayNum}</strong>
          <small>${esc(weekday)}</small>
        </button>
      `;
    }).join('');

    // Marcador de Hoje Vertical
    const todayDay = dayMap[t];
    const todayMarkerHTML = todayDay ? `
      <div class="timeline-today-marker" style="left:${todayDay.left + todayDay.width / 2}px">
        <div class="timeline-today-flag">Hoje</div>
      </div>
    ` : '';

    // Montar Camada 4: Trilhas de Atividades (Swimlanes) com altura fixa e layout didático
    const lanes = [
      { id: 'class', title: 'Aulas & Práticas', sub: 'Teóricas e Laboratório', icon: 'studies', types: ['class', 'welcome'] },
      { id: 'tutorial', title: 'Tutorias / PBL', sub: 'Discussões e Problemas', icon: 'target', types: ['tutorial'] },
      { id: 'community', title: 'Comunidade', sub: 'IESC e UBS', icon: 'cross', types: ['community'] },
      { id: 'exam', title: 'Avaliações', sub: 'Provas e Prazos', icon: 'exams', types: ['exam'] },
      { id: 'task', title: 'Tarefas', sub: 'A fazer', icon: 'tasks', types: ['study'] },
      { id: 'review', title: 'Revisões', sub: 'MedReview / Flashcards', icon: 'reviews', types: ['review'] },
      { id: 'study', title: 'Estudos', sub: 'Sessões planejadas', icon: 'studies', types: ['study'] }
    ];

    const lanesHTML = lanes.map(lane => {
      const laneEvents = all.filter(x => lane.types.includes(x.type) && (lane.id==='task'?isTimelineTask(x):lane.id==='study'?!isTimelineTask(x):true) && filterFn(x));
      if (activeFilter !== 'all' && activeFilter !== 'pending' && !laneEvents.length) return '';
      const color = laneColors[lane.id];
      let itemsHTML = '', laneHeight = zoomLevel === 'days' ? 122 : zoomLevel === 'weeks' ? 80 : 48;
      const buckets = new Map();
      laneEvents.forEach(x=>{
        const day=dayMap[x.date]; if (!day) return;
        // At semester scale a week becomes one meaningful summary, rather than unreadable cards.
        const key=zoomLevel==='general' ? Math.floor((day.index + (new Date(minDate+'T12:00:00Z').getUTCDay()+6)%7)/7) : day.index;
        if (!buckets.has(key)) buckets.set(key,[]);
        buckets.get(key).push(x);
      });
      buckets.forEach(group=>{
        group.sort((a,b)=>a.date.localeCompare(b.date)||(a.from||'').localeCompare(b.from||''));
        const first=dayMap[group[0].date];
        const offset=(new Date(first.date+'T12:00:00Z').getUTCDay()+6)%7;
        const bucketStart=zoomLevel==='general'?Math.max(0,first.index-offset):first.index;
        const bucketEnd=zoomLevel==='general'?Math.min(totalDays,first.index-offset+7):first.index+1;
        itemsHTML+=`<button type="button" class="timeline-fit-summary" style="--lane-color:${activityColor(group[0])};left:${bucketStart*dayWidth+3}px;width:${Math.max(8,(bucketEnd-bucketStart)*dayWidth-6)}px" data-action="timeline-period-details" data-lane="${lane.id}" data-from="${group[0].date}" data-to="${group[group.length-1].date}" data-start="${bucketStart}" data-end="${bucketEnd}" data-count="${group.length}" title="${esc(group.map(x=>displayTitle(x.title)).join(' · '))}"><strong>${group.length}</strong><span>${esc(displayTitle(group[0].title))}</span></button>`;

        if(zoomLevel==='general') {
          const offset=(new Date(first.date+'T12:00:00Z').getUTCDay()+6)%7;
          const start=Math.max(0,first.index-offset), end=Math.min(totalDays,first.index-offset+7);
          const done=group.filter(x=>getActivityStatus(x)==='completed').length;
          itemsHTML+=`<button class="timeline-week-summary" style="--lane-color:${activityColor(group[0])};left:${start*dayWidth+2}px;width:${Math.max(8,(end-start)*dayWidth-4)}px" data-action="timeline-open-period" data-date="${dayAdd(minDate,start)}" data-zoom="weeks" title="${group.length} atividades · ${done} concluídas · clique para explorar a semana"><strong>${group.length}</strong><span>ativ.</span><i style="width:${done/group.length*100}%"></i></button>`;
        } else if(zoomLevel==='weeks') {
          const done=group.filter(x=>getActivityStatus(x)==='completed').length;
          const previews=group.slice(0,1).map(x=>`<span class="timeline-week-item" style="--activity-color:${activityColor(x)}"><small>${esc(x.from||'Livre')} · ${esc(displayTitle(x.subject||'Atividade'))}</small><span>${esc(displayTitle(x.title))}</span></span>`).join('');
          itemsHTML+=`<button class="timeline-day-summary" style="--lane-color:${activityColor(group[0])};left:${first.left+4}px;width:${dayWidth-8}px" data-action="timeline-open-period" data-date="${first.date}" data-zoom="days" title="${esc(group.map(x=>displayTitle(x.title)).join(' · '))}">${previews}<small class="timeline-week-more">${group.length>1?'+'+(group.length-1)+' atividades · ':''}${done?done+' concluídas · ':''}Abrir dia →</small></button>`;
        } else {
          laneHeight=Math.max(laneHeight,group.length*110+12);
          group.forEach((x,index)=>{
            const status=getActivityStatus(x);
            const timeLabel=x.from ? x.from+(x.to?' – '+x.to:'') : 'Horário livre';
            const title=displayTitle(x.title);
            itemsHTML+=`<button type="button" class="timeline-act-card status-${status} ${searchQuery&&matchesSearch(x)?'is-search-match':''}" style="--lane-color:${activityColor(x)};left:${first.left+6}px;width:${dayWidth-12}px;top:${index*110+8}px;height:102px" data-action="timeline-activity-click" data-id="${esc(x.id)}" title="${esc(title+' · '+timeLabel+' · '+statusLabels[status])}"><span class="timeline-card-time">${esc(timeLabel)}</span><strong class="timeline-act-title">${esc(title)}</strong><span class="timeline-act-footer"><span class="timeline-act-sub">${esc(displayTitle(x.subject||'UC2'))}</span><span class="timeline-card-status">${status==='completed'?'✓ ':status==='in_progress'?'◔ ':''}${esc(statusLabels[status]||status)}</span></span></button>`;
          });
        }
      });
      return `<div data-lane="${lane.id}" data-natural-height="${laneHeight+26}" class="timeline-lane lane-${lane.id} ${collapsedLanes.has(lane.id)?'is-collapsed':''}" style="height:${collapsedLanes.has(lane.id)?26:laneEvents.length ? laneHeight+26 : 26}px;--lane-color:${color}">${makeSidebarHeader(lane.icon,lane.title,lane.sub,laneEvents.length,lane.id)}<div class="timeline-lane-items" style="width:${canvasWidth}px;height:${laneEvents.length ? laneHeight : 0}px;background-size:${dayWidth}px 100%">${itemsHTML}</div></div>`;
    }).join('');

    // Painel Foco do Dia ("O que tenho para fazer neste dia")
    const focusDay = dayMap[selectedDate] || dayMap[t] || Object.values(dayMap)[0];
    const dayEvents = focusDay ? focusDay.events.filter(filterFn) : [];
    let dayTotalMins = 0;
    dayEvents.forEach(e => dayTotalMins += getActivityDuration(e));

    const dayCardsHTML = dayEvents.length ? dayEvents.map(x => {
      const status = getActivityStatus(x);
      const isDone = status === 'completed';
      const timeStr = x.from ? (x.to ? x.from + ' – ' + x.to : x.from) : 'Horário livre';

      return `
        <div style="--activity-color:${activityColor(x)}" class="timeline-day-event-card ${isDone ? 'status-completed' : ''}" data-action="timeline-activity-click" data-id="${esc(x.id)}">
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
      <details class="timeline-day-focus" id="timeline-day-focus" ${dayOpen?'open':''}><summary>Agenda de ${fmt(focusDay?.date||t)} · ${dayEvents.length} atividades</summary>
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
      </details>
    `;

    return `
      <div class="timeline-view zoom-${zoomLevel}" style="--timeline-sidebar:${sidebar}px">
        ${heroHTML}
        <details class="timeline-tools" id="timeline-tools" ${toolsOpen||searchQuery||preparationExamId?'open':''}><summary>Buscar assunto ou preparar prova${searchQuery?' · busca ativa':''}${preparationExamId?' · avaliação selecionada':''}</summary>
        ${searchHTML}
        ${preparationHTML(preparationExam,all)}
        </details>

        ${overviewHTML}

        <div class="timeline-reading-guide"><span class="timeline-color-key" style="--activity-color:#FFC000">Tutoria</span><span class="timeline-color-key" style="--activity-color:#FBFF44">Prova</span><span class="timeline-color-key" style="--activity-color:#8752cf">Revisão</span><span class="timeline-color-key" style="--activity-color:#dc3545">Tarefa</span><small>${zoomLevel==='general'?'Resumo por semana · clique para aproximar':zoomLevel==='weeks'?'Distribuição por dia · clique para ver as atividades':'Atividades e horários · clique para abrir os detalhes'}</small></div>
        <div class="timeline-scroll-container" id="timeline-scroller" tabindex="0" aria-label="Linha do tempo. Use as setas para navegar e Control mais rolagem para ampliar.">
          <div class="timeline-canvas" style="width:${canvasWidth + sidebar}px">
            <div class="timeline-header-tracks">
            <!-- Camada 1: Faixas de Fases -->
            <div class="timeline-phases-track">
              <div style="position:relative;flex:1;height:100%">${phaseBandsHTML}</div>
            </div>

            <!-- Camada 2: Carga Horária Planejada -->
            <div class="timeline-track-caption"><span>Carga diária</span><small>Altura das barras = horas planejadas</small></div>
            <div class="timeline-load-track">
              <div style="position:relative;flex:1;height:100%">${loadBarsHTML}</div>
            </div>

            <div class="timeline-month-track"><div style="position:relative;flex:1">${monthsHTML}</div></div>
            <!-- Camada 3: Régua de Datas -->
            <div class="timeline-ruler-track">
              <div style="position:relative;flex:1;height:100%">${rulerColsHTML} ${todayMarkerHTML}</div>
            </div>

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

    persistDrawerDraft();
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
        <div class="breadcrumb" style="margin-bottom:0">SEQUÊNCIA DA MATÉRIA · SUGESTÕES POR DATA</div>
        <div class="timeline-continuity-steps">
          <div class="timeline-chain-step">
            <small>Anterior na matéria</small>
            ${continuity.previous ? btn(esc(displayTitle(continuity.previous.title)),'timeline-activity-click',`data-id="${esc(continuity.previous.id)}"`,'timeline-connection-link') : '<strong>Sem atividade anterior</strong>'}
            <span class="tiny muted">${continuity.previous ? fmt(continuity.previous.date) : '—'}</span>
          </div>
          <div class="timeline-chain-step current">
            <small>🎯 Atividade Atual</small>
            <strong>${esc(displayTitle(x.title))}</strong>
            <span class="tiny muted">${fmt(x.date)} (${timeStr})</span>
          </div>
          <div class="timeline-chain-step">
            <small>Próxima na matéria</small>
            ${continuity.next ? btn(esc(displayTitle(continuity.next.title)),'timeline-activity-click',`data-id="${esc(continuity.next.id)}"`,'timeline-connection-link') : '<strong>Sem próxima atividade</strong>'}
            <span class="tiny muted">${continuity.next ? fmt(continuity.next.date) : '—'}</span>
          </div>
          <div class="timeline-chain-step">
            <small>Próxima avaliação possível</small>
            ${continuity.exam ? btn(esc(displayTitle(continuity.exam.title)),'timeline-activity-click',`data-id="${esc(continuity.exam.id)}"`,'timeline-connection-link') : '<strong>Nenhuma avaliação encontrada</strong>'}
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
      <div class="timeline-drawer-card" role="region" aria-label="Detalhes da atividade">
        <div class="timeline-drawer-top"><strong>Detalhes da atividade</strong><button type="button" class="btn btn-small" data-action="timeline-detail-close" aria-label="Fechar detalhes">×</button></div>
        
        <div class="timeline-modal-detail">
          <div class="timeline-detail-header">
            <div class="timeline-detail-tags">
              <span class="tag gray">${esc(x.type || 'Atividade')}</span>
              <span class="tag" style="background:var(--accentbg);color:var(--accent)">${esc(displayTitle(x.subject || 'UC2'))}</span>
              <span class="tag timeline-color-key" style="--activity-color:${activityColor(x)}">${isTimelineTask(x)?'Tarefa':x.type==='review'?'Revisão':x.sheetColor?'Cor da planilha':'Atividade'}</span>
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

    let drawer=$('timeline-drawer');
    if(!drawer) {drawer=document.createElement('aside');drawer.id='timeline-drawer';drawer.addEventListener('change',persistDrawerDraft);document.body.appendChild(drawer);}
    drawer.hidden=false;
    drawer.innerHTML=modalHTML;
    drawer.querySelectorAll('textarea').forEach(el=>el.dataset.initial=el.value);
    document.querySelectorAll('.timeline-act-card').forEach(el=>el.classList.toggle('is-inspected',el.dataset.id===id));
    drawer.querySelector('[data-action="timeline-detail-close"]')?.focus({preventScroll:true});
  }

  function showPeriodDetails(lane,from,to) {
    persistDrawerDraft();selectedActivityId=null;
    const exam=events().find(x=>x.id===preparationExamId),topics=exam?scopeFor(exam):[];
    const belongs=x=>lane==='task'?isTimelineTask(x):lane==='review'?x.type==='review':lane==='study'?x.type==='study'&&!isTimelineTask(x):lane==='class'?['class','welcome'].includes(x.type):x.type===lane;
    const items=events().filter(x=>x.date>=from&&x.date<=to&&belongs(x)&&matchesCategory(x)&&matchesSearch(x)&&(!exam||!topics.length||x.id===exam.id||(x.date<=exam.date&&topics.some(t=>matchesTopic(x,t)))));
    let drawer=$('timeline-drawer');
    if(!drawer){drawer=document.createElement('aside');drawer.id='timeline-drawer';drawer.addEventListener('change',persistDrawerDraft);document.body.appendChild(drawer);}
    drawer.hidden=false;
    drawer.innerHTML=`<div class="timeline-drawer-card" role="region" aria-label="Atividades do período"><div class="timeline-drawer-top"><strong>${items.length} atividades · ${fmt(from)}${from!==to?' – '+fmt(to):''}</strong><button class="btn btn-small" data-action="timeline-detail-close" aria-label="Fechar detalhes">×</button></div><div class="timeline-period-list">${items.map(x=>`<button class="timeline-period-item" style="--activity-color:${activityColor(x)}" data-action="timeline-activity-click" data-id="${esc(x.id)}"><small>${fmt(x.date)} · ${esc(x.from||'Horário livre')}</small><strong>${esc(displayTitle(x.title))}</strong><span>${esc(x.subject||'UC2')} · ${esc(statusLabels[getActivityStatus(x)]||'Planejado')}</span></button>`).join('')||'<p>Nenhuma atividade neste período.</p>'}</div></div>`;
    drawer.querySelector('[data-action="timeline-detail-close"]')?.focus({preventScroll:true});
  }

  function persistDrawerDraft() {
    const drawer=$('timeline-drawer');
    if(!drawer||drawer.hidden||!selectedActivityId)return;
    const objective=$('timeline-act-objective'),notes=$('timeline-act-notes');
    const changed=[objective,notes].filter(el=>el&&el.value!==el.dataset.initial);
    if(!changed.length)return;
    ensureTimelineMeta();
    const meta=data.settings.timelineActivityMeta[selectedActivityId] ||= {};
    if(changed.includes(objective))meta.objective=objective.value.trim();
    if(changed.includes(notes))meta.notes=notes.value.trim();
    changed.forEach(el=>el.dataset.initial=el.value);
    save();
  }
  function closeTimelineDetail() {
    persistDrawerDraft();
    const id=selectedActivityId;
    selectedActivityId=null;
    const drawer=$('timeline-drawer');if(drawer)drawer.hidden=true;
    document.querySelectorAll('.is-inspected').forEach(el=>el.classList.remove('is-inspected'));
    const card=[...document.querySelectorAll('.timeline-act-card')].find(el=>el.dataset.id===id);
    card?.focus({preventScroll:true});
  }
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('timeline-drawer')&&!$('timeline-drawer').hidden)closeTimelineDetail();});

  // 7. Ações de Regras e Manipulação
  function setActivityStatus(id, newStatus) {
    persistDrawerDraft();
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
    if(objEl)objEl.dataset.initial=objEl.value;
    if(noteEl)noteEl.dataset.initial=noteEl.value;
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

    const sKey = examScopeKey(exam);
    if (!data.examScopes) data.examScopes = {};
    if (!data.examScopes[sKey]) data.examScopes[sKey] = [...scopeFor(exam)];

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
    closeTimelineDetail();
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
    closeTimelineDetail();
    closeModal();
    openForm('task', {
      title: 'Fixar e resumir: ' + x.title,
      subject: x.subject || '',
      date: dayAdd(x.date || today(), 1),
      estimate: '45'
    });
  }

  function scrollToDate(date, behavior='auto') {
    const el=$('timeline-scroller'); if (!el||!geometry) return;
    const offset=Math.max(0,Math.min(geometry.totalDays-1,dateDiff(date,geometry.minDate)))+.5;
    el.scrollTo({left:Math.max(0,offset*geometry.dayWidth-(el.clientWidth-geometry.sidebar)/2),behavior});
    updateOverview();
  }
  function updateOverview() {
    const el=$('timeline-scroller'), visor=$('timeline-map-window'); if(!el||!visor||!geometry) return;
    const visible=Math.min(geometry.canvasWidth,el.clientWidth-geometry.sidebar);
    visor.style.left=(el.scrollLeft/geometry.canvasWidth*100)+'%';
    visor.style.width=(visible/geometry.canvasWidth*100)+'%';
    const firstVisible=el.scrollLeft/geometry.dayWidth,lastVisible=(el.scrollLeft+visible)/geometry.dayWidth;
    const lanes=[...el.querySelectorAll('.timeline-lane')];
    const active=[];
    lanes.forEach(lane=>{
      const groups=[...lane.querySelectorAll('.timeline-fit-summary')].filter(item=>Number(item.dataset.end)>firstVisible+.001&&Number(item.dataset.start)<lastVisible-.001);
      lane.classList.toggle('is-window-empty',groups.length===0);
      if(!groups.length)return;
      const count=groups.reduce((sum,item)=>sum+Number(item.dataset.count),0);
      let countButton=lane.querySelector('.timeline-section-count');
      if(countButton){
        // A category total always opens every matching activity in the visible dates.
        if(countButton.tagName!=='BUTTON'){const replacement=document.createElement('button');replacement.className=countButton.className;countButton.replaceWith(replacement);countButton=replacement;}
        countButton.type='button';countButton.textContent=count+' '+(count===1?'atividade':'atividades')+' · ver';
        Object.assign(countButton.dataset,{action:'timeline-period-details',lane:lane.dataset.lane,from:dayAdd(geometry.minDate,Math.max(0,Math.floor(firstVisible))),to:dayAdd(geometry.minDate,Math.min(geometry.totalDays-1,Math.ceil(lastVisible)-1))});
      }
      active.push(lane);
    });
    const available=Math.max(1,el.clientHeight-(el.querySelector('.timeline-header-tracks')?.offsetHeight||0)-2);
    const collapsed=active.filter(lane=>collapsedLanes.has(lane.dataset.lane));
    const share=Math.max(20,(available-collapsed.length*26)/Math.max(1,active.length-collapsed.length));
    active.forEach(lane=>{
      const row=collapsedLanes.has(lane.dataset.lane)?26:Math.min(Number(lane.dataset.naturalHeight),share);
      lane.style.height=row+'px';
      const compact=row<Number(lane.dataset.naturalHeight)-1;
      lane.classList.toggle('is-fit-compact',compact);
      lane.classList.toggle('is-header-only',row<46);
      lane.style.setProperty('--fit-item-height',Math.max(18,row-30)+'px');
      const items=lane.querySelector('.timeline-lane-items');if(items)items.style.height=Math.max(0,row-26)+'px';
      const toggle=lane.querySelector('.timeline-lane-toggle');if(toggle)toggle.disabled=false;
    });
    el.scrollTop=0;
    const max=Math.max(0,el.scrollWidth-el.clientWidth);
    const range=$('timeline-position'); if(range) {range.value=max?el.scrollLeft/max*1000:0;range.disabled=!max;}
    const start=Math.max(0,Math.floor(el.scrollLeft/geometry.dayWidth));
    const end=Math.min(geometry.totalDays-1,Math.ceil((el.scrollLeft+visible)/geometry.dayWidth)-1);
    const label=$('timeline-visible-range');
    if(label) label.textContent=fmt(dayAdd(geometry.minDate,start))+' – '+fmt(dayAdd(geometry.minDate,end));
  }
  function bindTimeline() {
    const el=$('timeline-scroller'); if(!el) return;
    el.addEventListener('scroll',()=>{cancelAnimationFrame(scrollFrame);scrollFrame=requestAnimationFrame(updateOverview);},{passive:true});
    el.addEventListener('dblclick',e=>{
      const day=e.target.closest('[data-date]');
      if(day) focusDate(day.dataset.date,scales[Math.min(2,scales.indexOf(zoomLevel)+1)]);
    });
    const map=$('timeline-map');
    const seek=e=>{
      const rect=map.getBoundingClientRect();
      const ratio=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));
      el.scrollLeft=ratio*geometry.canvasWidth-(el.clientWidth-geometry.sidebar)/2;
      updateOverview();
    };
    map.addEventListener('pointerdown',e=>{if(e.button!==0)return;map.setPointerCapture(e.pointerId);seek(e);});
    map.addEventListener('pointermove',e=>{if(map.hasPointerCapture(e.pointerId))seek(e);});
    map.addEventListener('pointerup',e=>{if(map.hasPointerCapture(e.pointerId))map.releasePointerCapture(e.pointerId);});
    $('timeline-position').addEventListener('input',e=>{el.scrollLeft=Number(e.target.value)/1000*(el.scrollWidth-el.clientWidth);updateOverview();});
    const fitViewport=()=>{el.style.height=el.style.maxHeight=Math.max(240,Math.min(560,window.innerHeight-(el.getBoundingClientRect().top+window.scrollY)-18))+'px';updateOverview();};
    fitViewport();
    $('timeline-tools')?.addEventListener('toggle',e=>{toolsOpen=e.target.open;fitViewport();});
    $('timeline-day-focus')?.addEventListener('toggle',e=>{dayOpen=e.target.open;});
    const search=$('timeline-search');
    const runSearch=(jump=false)=>{
      clearTimeout(searchTimer); searchQuery=search.value.trim();searchIndex=0;
      if(jump){jumpSearch(0);return;}
      const caret=search.selectionStart;
      render();const replacement=$('timeline-search');replacement?.focus({preventScroll:true});replacement?.setSelectionRange(caret,caret);
    };
    search?.addEventListener('input',()=>{searchQuery=search.value.trim();searchIndex=0;clearTimeout(searchTimer);searchTimer=setTimeout(()=>runSearch(),220);});
    $('timeline-search-form')?.addEventListener('submit',e=>{e.preventDefault();runSearch(true);});
    $('timeline-prep-exam')?.addEventListener('change',e=>{
      preparationExamId=e.target.value;scopeEditorOpen=true;searchIndex=0;
      const exam=events().find(x=>x.id===preparationExamId);if(exam)focusDate(exam.date,'weeks');else render();
    });
    $('timeline-scope-editor')?.addEventListener('toggle',e=>{scopeEditorOpen=e.target.open;});
    $('timeline-scope-form')?.addEventListener('submit',e=>{
      e.preventDefault();const exam=events().find(x=>x.id===preparationExamId);if(!exam)return;
      const topic=e.target.elements.topic.value.trim(),subject=e.target.elements.subject.value.trim();
      if(!topic)return;addScopeTopic(exam,topic,subject);render();
    });
    document.querySelectorAll('[data-scope-event],[data-scope-index]').forEach(input=>input.addEventListener('change',()=>{
      const all=events(),exam=all.find(x=>x.id===preparationExamId);if(!exam)return;
      if(input.dataset.scopeEvent){const activity=all.find(x=>x.id===input.dataset.scopeEvent);if(activity)addScopeTopic(exam,activity.title,activity.subject);}
      else{data.examScopes ||= {};data.examScopes[examScopeKey(exam)]=scopeFor(exam).filter((_,index)=>index!==Number(input.dataset.scopeIndex));save();}
      render();
    }));
    const zoom=$('timeline-zoom-range');
    if(zoom) zoom.addEventListener('change',e=>setZoom(e.target.value));
    updateOverview();
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
      clearTimeout(searchTimer);
      const oldLeft=$('timeline-scroller')?.scrollLeft,oldTop=$('timeline-scroller')?.scrollTop;
      nav();
      $('breadcrumb').textContent = 'LINHA DO TEMPO DO CRONOGRAMA';
      $('heading').textContent = 'Linha do Tempo';
      $('subtitle').textContent = 'Explore o semestre, encontre sua semana e aproxime para organizar cada dia.';
      $('app').innerHTML = timelineView();
      renderAcademicStatus();
      ensureMobileMore();
      if ($('timeline-scroller')) {
        if(pendingAnchor!==null) {
          $('timeline-scroller').scrollLeft=Math.max(0,pendingAnchor*geometry.dayWidth-(pendingPixel??($('timeline-scroller').clientWidth-geometry.sidebar)/2));
          pendingAnchor=null; pendingPixel=null;
        } else if(oldLeft!==undefined) $('timeline-scroller').scrollLeft=oldLeft;
        else scrollToDate(selectedDate);
        bindTimeline();

      }
      return;
    }

    if($('timeline-drawer')&&!$('timeline-drawer').hidden)closeTimelineDetail();
    previousRender();
    ensureMobileMore();
  };

  document.addEventListener('wheel',e=>{
    const el=$('timeline-scroller');
    if(page!=='timeline'||!el||!el.contains(e.target)||(!e.ctrlKey&&!e.metaKey))return;
    e.preventDefault();
    wheelDelta+=Math.max(-6,Math.min(6,e.deltaY*.08));wheelX=e.clientX;
    if(wheelFrame!==null)return;
    wheelFrame=requestAnimationFrame(()=>{
      wheelFrame=null;
      const current=$('timeline-scroller');
      if(!current||page!=='timeline'){wheelDelta=0;return;}
      const local=Math.max(0,Math.min(current.clientWidth,wheelX-current.getBoundingClientRect().left));
      const delta=wheelDelta;wheelDelta=0;
      setZoom(zoomValue-delta,(current.scrollLeft+local)/geometry.dayWidth,local);
    });
  },{passive:false});
  let layoutResizeTimer=null;
  window.addEventListener('resize',()=>{
    clearTimeout(layoutResizeTimer);
    layoutResizeTimer=setTimeout(()=>{if(page==='timeline'){pendingAnchor=visibleAnchor();render();}},100);
  });
  window.addEventListener('planning-account-reset',()=>{
    selectedActivityId=null;
    const drawer=$('timeline-drawer');if(drawer){drawer.hidden=true;drawer.innerHTML='';}
  });

  // 9. Ouvinte de Eventos de Clique
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const action = b.dataset.action;
    const id = b.dataset.id;

    switch (action) {
      case 'timeline-period-details':showPeriodDetails(b.dataset.lane,b.dataset.from,b.dataset.to);break;
      case 'timeline-lane-toggle':
        if(collapsedLanes.has(b.dataset.lane))collapsedLanes.delete(b.dataset.lane);else collapsedLanes.add(b.dataset.lane);render();break;
      case 'timeline-search-prev': jumpSearch(-1);break;
      case 'timeline-search-next': jumpSearch(1);break;
      case 'timeline-search-clear': clearTimeout(searchTimer);searchQuery='';searchIndex=0;render();break;
      case 'timeline-prep-exit': preparationExamId='';render();break;
      case 'timeline-zoom':
        changeZoom(b.dataset.zoom);
        break;
      case 'timeline-filter':
        activeFilter = b.dataset.filter;
        render();
        break;
      case 'timeline-zoom-step':
        setZoom(zoomValue+Number(b.dataset.step)*10);
        break;
      case 'timeline-pan': {
        const el=$('timeline-scroller');
        if(el) el.scrollBy({left:(el.clientWidth-geometry.sidebar)*Number(b.dataset.direction),behavior:'smooth'});
        break;
      }
      case 'timeline-open-period':
        focusDate(b.dataset.date,b.dataset.zoom);
        break;
      case 'timeline-scroll-today':
        focusDate(today());
        break;
      case 'timeline-view-list':
        goto('calendar');
        break;
      case 'timeline-select-day':
        selectedDate=b.dataset.date;
        render();
        break;
      case 'timeline-phase-click':
        selectedDate=b.dataset.from;
        pendingAnchor=geometry ? dateDiff(b.dataset.from,geometry.minDate)+Math.min(3.5,(dateDiff(b.dataset.to,b.dataset.from)+1)/2) : null;
        zoomLevel='weeks'; zoomValue=60;
        render();
        break;
      case 'timeline-detail-close':
        closeTimelineDetail();
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

  window.timelineView = timelineView;
  nav();
  ensureMobileMore();
})();
