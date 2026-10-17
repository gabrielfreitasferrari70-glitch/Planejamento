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
  const ratingLabels={again:'Novamente',hard:'Difícil',good:'Bom',easy:'Fácil'};
  function ratingBars(ratings,total){
    const known=Object.values(ratings).reduce((a,b)=>a+b,0);
    return '<div class="mr-ratings">'+Object.entries(ratingLabels).map(([key,label])=>{
      const count=ratings[key]||0,pct=total?Math.round(count/total*100):0;
      return '<div class="mr-rating '+key+'"><div><span>'+label+'</span><strong>'+count+' <small>('+pct+'%)</small></strong></div><div class="mr-track"><span style="width:'+pct+'%"></span></div></div>';
    }).join('')+'</div>'+(known<total?'<p class="tiny">'+(total-known)+' respostas sem avaliação de dificuldade identificada.</p>':'');
  }
  function activity(summary){
    if(!summary)return '';
    const count=state.period==='7'?7:14,days=Array.from({length:count},(_,i)=>dayAdd(today(),i+1-count));
    const indexed=new Map(summary.days.map(day=>[day.date,day])),max=Math.max(1,...days.map(date=>indexed.get(date)?.count||0));
    const bars=days.map(date=>{
      const day=indexed.get(date),n=day?.count||0,label=formatDay(date)+': '+n+' revisões';
      return '<button type="button" class="mr-activity-day" '+(day?'data-action="medreview-day" data-date="'+date+'"':'disabled')+' aria-label="'+esc(label)+'" title="'+esc(label)+'"><strong>'+n+'</strong><span class="mr-activity-track"><span style="height:'+Math.max(n?3:0,n/max*100)+'%"></span></span><small>'+date.slice(8)+'</small></button>';
    }).join('');
    const active=summary.days.length,best=summary.days.reduce((a,b)=>b.count>(a?.count||0)?b:a,null);
    const metrics='<div class="mr-insights"><div><strong>'+active+'</strong><span>Dias com revisões</span></div><div><strong>'+Math.round(summary.total/(active||1))+'</strong><span>Média por dia ativo</span></div><div><strong>'+(best?.count||0)+'</strong><span>Maior volume diário'+(best?' · '+formatDay(best.date):'')+'</span></div></div>';
    const grouped=new Map();summary.days.forEach(day=>day.distribution.forEach(group=>{grouped.set(group.path,(grouped.get(group.path)||0)+group.count)}));
    const top=[...grouped].sort((a,b)=>b[1]-a[1]).slice(0,5);
    const sources=top.map(([path,n])=>'<div class="mr-source"><div><span>'+esc(path)+'</span><strong>'+n+' revisões</strong></div><div class="mr-track"><span style="width:'+(summary.total?n/summary.total*100:0)+'%"></span></div></div>').join('')||empty('Sem revisões no período.');
    return panel('Seu ritmo de revisão','<p class="tiny">Últimos '+count+' dias, incluindo dias sem revisões. Clique em uma barra para explorar o dia.</p><div class="mr-activity" role="group" aria-label="Revisões por dia">'+bars+'</div>'+metrics)+panel('Baralhos mais revisados','<p class="tiny">Os cinco baralhos com mais respostas no período selecionado. A barra indica a participação no total.</p>'+sources);
  }
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
    const list=days.length?days.map(day=>{
      const previews=day.distribution.slice(0,2).map(group=>'<span class="mr-day-source">'+esc(group.path.split(' / ').pop())+' <b>'+group.count+'</b></span>').join('');
      return '<button class="medreview-day" type="button" data-action="medreview-day" data-date="'+day.date+'"><span class="mr-day-info"><strong>'+formatDay(day.date)+'</strong><small>'+day.uniqueCards+' cartões distintos · '+day.distribution.length+' baralhos</small><span class="mr-day-previews">'+previews+(day.distribution.length>2?'<span class="tiny">+ '+(day.distribution.length-2)+' baralhos</span>':'')+'</span></span><span class="medreview-count">'+day.count+'<small>revisões</small><span class="mr-day-open">Ver distribuição →</span></span></button>';
    }).join(''):empty(summary?'Nenhuma revisão registrada nesse período.':connected?'O histórico aparecerá após a leitura do MedReview.':'O histórico ficará disponível depois de conectar sua conta.');
    const notes=summary&&(summary.invalidDates||summary.unidentified)?'<p class="tiny">'+(summary.unidentified?summary.unidentified+' revisões sem baralho identificável. ':'')+(summary.invalidDates?summary.invalidDates+' registros sem data válida não foram contabilizados.':'')+'</p>':'';
    const lastRead=summary&&state.syncedAt&&state.status==='error'?'<p class="tiny">Última leitura concluída: '+new Date(state.syncedAt).toLocaleString('pt-BR',{timeZone:ZONE})+'</p>':'';
    const localPending=(data.reviews||[]).filter(x=>!x.done),localDue=localPending.filter(x=>x.due<=today()).length;
    const localSection='<details class="panel local-review-details" id="local-review-details"'+(localDue?' open':'')+'><summary>↻ Revisões programadas do planejamento ('+localPending.length+(localPending.length===1?' pendente':' pendentes')+(localDue?' · '+localDue+' para hoje/atrasadas':'')+')</summary>'+originalReviewView()+'</details>';
    return panel('Flashcards · MedReview','<p class="muted">Suas revisões realizadas no MedReview, agrupadas por dia. Clique no total diário para ver a distribuição por baralho.</p><div class="pill-row">'+actions+'<a href="'+esc(config?.site||'https://flashcard-lac-xi.vercel.app')+'" target="_blank" rel="noopener noreferrer" class="surface-link">Abrir MedReview ↗</a></div>'+identity+'<p class="tiny" role="status">'+esc(status)+'</p>'+lastRead+selector)+stats+activity(summary)+panel('Histórico diário','<p class="tiny">Uma revisão é uma resposta registrada. O mesmo cartão pode ser respondido mais de uma vez.</p>'+list+notes)+localSection;
  }
  let activeReviewTab = 'flashcards';

  const TRACKER_STORAGE_KEY = 'planejamento-evaluated-classes';
  const AUTO_MISSED_MIN_DATE = '2026-10-16';

  function isGabrielAdmin() {
    return Boolean(window.AccountFeatureData?.isOwner());
  }

  function isLessonEvent(ev) {
    return Boolean(ev && ev.title && /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') && !['study', 'review', 'free', 'break', 'exam'].includes(ev.type));
  }

  function eventDuration(ev) {
    if (ev && ev.from && ev.to) {
      const mFrom = mins(ev.from), mTo = mins(ev.to);
      if (mTo > mFrom) return mTo - mFrom;
    }
    return Number(ev?.minutes) || 90;
  }

  function candidateLessonEvents() {
    const base = typeof academicEvents === 'function' ? academicEvents() : (data.replacement || []);
    const all = [...(base || []), ...(data.events || [])].filter(isLessonEvent);
    const seen = new Set(all.map(e => (e.id || '') + '|' + e.date + '|' + e.title));
    (data.tasks || []).forEach(t => {
      if (t && t.origin === 'class' && t.title && /^\d{4}-\d{2}-\d{2}$/.test(t.classDate || t.date || '')) {
        const d = t.classDate || t.date;
        const topic = t.title.replace(/^(Estudar|Aprender \/ Aprofundar|Repor aula não assistida):\s*/i, '').trim();
        const evId = t.classSourceId || t.id;
        const key = evId + '|' + d + '|' + topic;
        if (topic && !seen.has(key) && !all.some(e => (e.id && e.id === evId) || (e.date === d && e.title === topic))) {
          seen.add(key);
          all.push({ id: evId, date: d, title: topic, subject: t.subject || 'UC2', type: 'class', minutes: Number(t.estimate) || 90 });
        }
      }
    });
    return all;
  }

  function syncUnvotedPastClasses(asOf = today()) {
    if (!isGabrielAdmin()) return false;
    const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(asOf || '') ? asOf : today();
    const pastLessons = candidateLessonEvents().filter(ev => ev.date >= AUTO_MISSED_MIN_DATE && ev.date < todayStr);
    if (!pastLessons.length) return false;
    const list = window.AccountFeatureData?.trackedClasses() || [];
    let changed = false;

    pastLessons.forEach(ev => {
      const evalId = 'eval-' + (ev.id || (ev.date + '-' + ev.title.slice(0, 24)));
      const found = list.find(x =>
        x.id === evalId ||
        (ev.id && x.eventId === ev.id) ||
        (x.topic === ev.title && x.date === ev.date)
      );
      if (!found) {
        list.push({
          id: evalId,
          eventId: ev.id || '',
          eventType: ev.type || 'class',
          topic: ev.title,
          subject: ev.subject || 'UC2',
          date: ev.date,
          minutes: eventDuration(ev),
          professor: ev.professor || '',
          status: 'missed',
          autoMissed: true,
          votedAt: ev.date + 'T23:59:59.000Z',
          masteredAt: null
        });
        changed = true;
      }
    });

    if (changed) {
      saveTrackedClasses(list);
    }
    return changed;
  }

  function getTrackedClasses() {
    syncUnvotedPastClasses();
    let list = window.AccountFeatureData?.trackedClasses()||[];
    // Sincroniza apenas sessões de aulas registradas nos fechamentos anteriores
    const existingSessions = data.sessions || [];
    existingSessions.forEach(s => {
      if (!s.evaluationStatus && s.origin !== 'closing') return;
      let found = list.find(x => x.topic === s.topic && x.date === s.date);
      if (!found) {
        list.push({
          id: s.id || uid(),
          topic: s.topic,
          subject: s.subject || 'UC2',
          date: s.date,
          minutes: s.minutes || 90,
          professor: s.professor || '',
          status: s.evaluationStatus || 'review',
          votedAt: s.votedAt || s.date || new Date().toISOString(),
          masteredAt: s.masteredAt || null
        });
      }
    });

    // Sincroniza tarefas de aprender/repor
    (data.tasks || []).forEach(t => {
      if (t.title && t.title.startsWith('Aprender / Aprofundar: ')) {
        const topic = t.title.replace('Aprender / Aprofundar: ', '').trim();
        let found = list.find(x => x.topic === topic);
        if (!found) {
          list.push({
            id: t.id || uid(),
            topic,
            subject: t.subject || 'UC2',
            date: t.date || today(),
            minutes: 90,
            professor: '',
            status: t.done ? 'mastered' : 'learn',
            votedAt: new Date().toISOString(),
            masteredAt: t.done ? new Date().toISOString() : null
          });
        }
      } else if (t.title && t.title.startsWith('Repor aula não assistida: ')) {
        const topic = t.title.replace('Repor aula não assistida: ', '').trim();
        let found = list.find(x => x.topic === topic);
        if (!found) {
          list.push({
            id: t.id || uid(),
            topic,
            subject: t.subject || 'UC2',
            date: t.date || today(),
            minutes: 90,
            professor: '',
            status: t.done ? 'mastered' : 'missed',
            votedAt: new Date().toISOString(),
            masteredAt: t.done ? new Date().toISOString() : null
          });
        }
      }
    });

    return list;
  }

  function getStandbyClasses(asOf = today()) {
    if (!isGabrielAdmin()) return [];
    const list = getTrackedClasses();
    const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(asOf || '') ? asOf : today();
    return candidateLessonEvents().filter(ev =>
      ev.date === todayStr &&
      !list.some(x => (ev.id && (x.eventId === ev.id || x.id === 'eval-' + ev.id)) || (x.topic === ev.title && x.date === ev.date))
    );
  }

  function saveTrackedClasses(list) {
    window.AccountFeatureData?.saveTrackedClasses(list);
  }

  function applyClassStatusSideEffects(item, newStatus) {
    const title = item.topic;
    const subject = item.subject || 'UC2';
    const dateStr = item.date || today();
    const duration = Number(item.minutes) || 90;

    if (newStatus === 'review') {
      let existingSession = (data.sessions || []).find(s => s.topic === title && s.date === dateStr && s.origin === 'closing');
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
      const configuredIntervals = typeof reviewIntervals === 'function' ? reviewIntervals() : [];
      const uniqueIntervals = [...new Set(configuredIntervals.length ? configuredIntervals : [1, 7, 30])];
      for (const n of uniqueIntervals) {
        const due = dayAdd(dateStr, n);
        const alreadyExists = (data.reviews || []).some(r => r.topic === title && r.due === due && r.interval === n);
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
        }
      }
      if (item.eventId) {
        window.PlanningClassTasks?.followup(
          data,
          { id: item.eventId, type: item.eventType || 'class', title, subject, date: dateStr },
          { title: `Estudar: ${title}`, date: dateStr, estimate: 60 },
          dateStr
        );
      }
    } else if (newStatus === 'learn' || newStatus === 'missed') {
      const followupFields = newStatus === 'learn'
        ? { title: `Aprender / Aprofundar: ${title}`, date: dayAdd(dateStr, 2), estimate: 90 }
        : { title: `Repor aula não assistida: ${title}`, date: dayAdd(dateStr, 3), estimate: 60 };
      const reusedTask = item.eventId && window.PlanningClassTasks?.followup(
        data,
        { id: item.eventId, type: item.eventType || 'class', title, subject, date: dateStr },
        followupFields,
        dateStr
      );
      if (!reusedTask) {
        const existingTask = (data.tasks || []).find(t =>
          !t.done && (
            (item.eventId && t.classSourceId === item.eventId) ||
            t.title === `Estudar: ${title}` ||
            t.title === `Aprender / Aprofundar: ${title}` ||
            t.title === `Repor aula não assistida: ${title}`
          )
        );
        if (existingTask) {
          Object.assign(existingTask, followupFields);
        }
      }
    }
  }

  function setClassStatus(id, newStatus) {
    const list = getTrackedClasses();
    const item = list.find(x => x.id === id);
    if (!item) return;

    item.status = newStatus;
    item.autoMissed = false;
    item.votedAt = new Date().toISOString();
    if (newStatus === 'mastered') {
      item.masteredAt = new Date().toISOString();
      // Conclui revisões pendentes desse tópico
      (data.reviews || []).filter(r => r.topic === item.topic && !r.done).forEach(r => {
        r.done = true;
        r.completedAt = new Date().toISOString();
      });
      // Conclui tarefas desse tópico
      (data.tasks || []).filter(t => t.title && t.title.includes(item.topic) && !t.done).forEach(t => {
        t.done = true;
      });
      notify(`"${item.topic}" marcado como Concluído! Movido para Conteúdos Dominados 📘`);
    } else if (newStatus === 'review') {
      item.masteredAt = null;
      applyClassStatusSideEffects(item, 'review');
      notify(`"${item.topic}" movido para Revisão 🟢 (revisões programadas geradas)`);
    } else if (newStatus === 'learn') {
      item.masteredAt = null;
      applyClassStatusSideEffects(item, 'learn');
      notify(`"${item.topic}" marcado como Necessidade de Aprender 🟡`);
    } else if (newStatus === 'missed') {
      item.masteredAt = null;
      applyClassStatusSideEffects(item, 'missed');
      notify(`"${item.topic}" marcado como Não Vista 🔴`);
    }

    saveTrackedClasses(list);
    save();
    render();
  }

  function voteStandbyClass(evId, dateStr, status) {
    const ev = candidateLessonEvents().find(e => (evId && e.id === evId) || e.date === dateStr);
    if (!ev) return;
    const list = getTrackedClasses();
    const evalId = 'eval-' + (ev.id || (ev.date + '-' + ev.title.slice(0, 24)));
    let item = list.find(x => x.id === evalId || (ev.id && x.eventId === ev.id) || (x.topic === ev.title && x.date === ev.date));
    if (!item) {
      item = {
        id: evalId,
        eventId: ev.id || '',
        eventType: ev.type || 'class',
        topic: ev.title,
        subject: ev.subject || 'UC2',
        date: ev.date,
        minutes: eventDuration(ev),
        professor: ev.professor || '',
        status,
        autoMissed: false,
        votedAt: new Date().toISOString(),
        masteredAt: null
      };
      list.push(item);
    } else {
      item.status = status;
      item.autoMissed = false;
      item.votedAt = new Date().toISOString();
    }
    applyClassStatusSideEffects(item, status);
    saveTrackedClasses(list);
    save();
    render();
    const labels = { review: 'Revisão 🟢', learn: 'Aprender 🟡', missed: 'Não Vista 🔴' };
    notify(`"${item.topic}" votada como ${labels[status] || status}!`);
  }

  window.ClassStatusTracker = {
    getTrackedClasses,
    getStandbyClasses,
    syncUnvotedPastClasses,
    saveTrackedClasses,
    setClassStatus,
    voteStandbyClass
  };

  function reviewTabsHeader() {
    const list = getTrackedClasses();
    const standbyCount = getStandbyClasses().length;
    const activeCount = list.filter(x => x.status !== 'mastered').length + standbyCount;
    const masteredCount = list.filter(x => x.status === 'mastered').length;
    const canDoClosing = isGabrielAdmin();

    return '<div class="section-actions" style="margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid var(--border)">' +
      '<div class="segmented">' +
        '<button class="'+(activeReviewTab==='flashcards'?'active':'')+'" data-action="set-review-tab" data-tab="flashcards">🃏 Flashcards</button>' +
        '<button class="'+(activeReviewTab==='aulas'?'active':'')+'" data-action="set-review-tab" data-tab="aulas">🎓 Aulas & Cronograma ('+activeCount+')</button>' +
        '<button class="'+(activeReviewTab==='dominadas'?'active':'')+'" data-action="set-review-tab" data-tab="dominadas">📘 Conteúdos Dominados ('+masteredCount+')</button>' +
      '</div>' +
      (canDoClosing ? (
      '<div class="pill-row">' +
        btn('🌙 Fechamento do Dia','open-day-closing','','btn btn-primary') +
      '</div>'
      ) : '') +
    '</div>';
  }

  let aulaFolder = null;
  function classCardHTML(item) {
    let badgeClass = 'review', badgeLabel = '🟢 Revisão', cardClass = 'status-review';
    if (item.status === 'learn') {
      badgeClass = 'learn'; badgeLabel = '🟡 Aprender'; cardClass = 'status-learn';
    } else if (item.status === 'missed') {
      badgeClass = 'missed';
      badgeLabel = item.autoMissed ? '🔴 Não vista (automático · sem voto)' : '🔴 Não vista';
      cardClass = 'status-missed';
    }
    const autoNotice = (item.status === 'missed' && item.autoMissed)
      ? '<p class="tiny" style="margin:0 0 10px;padding:6px 10px;border-radius:8px;background:rgba(239,68,68,0.1);color:var(--text)">⚠️ Como não houve voto no fechamento de <b>' + fmt(item.date) + '</b>, esta aula entrou automaticamente como <b>Não vista</b>. Você pode alterar o voto abaixo a qualquer momento:</p>'
      : '';
    return '<div class="class-status-card ' + cardClass + '">' +
      '<div class="pill-row between" style="margin-bottom:8px">' +
        '<span class="status-badge ' + badgeClass + '">' + badgeLabel + '</span>' +
        '<small class="muted">Aula de ' + fmt(item.date) + '</small>' +
      '</div>' +
      '<h3 style="font-size:15px;margin:0 0 4px;font-weight:750">' + esc(item.topic) + '</h3>' +
      '<p class="muted" style="font-size:12px;margin:0 0 12px">' +
        esc(item.subject || 'UC2') + (item.professor ? ' · ' + esc(item.professor.replace(/^Prof\.?\s*/i, 'Prof. ')) : '') + ' · ' + (item.minutes || 90) + ' min' +
      '</p>' +
      autoNotice +
      '<div class="pill-row between" style="border-top:1px solid var(--border);padding-top:12px;flex-wrap:wrap;gap:10px">' +
        '<button class="btn btn-mastered" data-action="mark-class-mastered" data-id="' + esc(item.id) + '">✓ Concluir (Dominei o assunto) 📘</button>' +
        '<div class="pill-row">' +
          '<span class="tiny muted">Mudar voto:</span>' +
          '<button class="btn btn-small" data-action="set-class-status" data-id="' + esc(item.id) + '" data-status="review" title="Mudar para Revisão (Verde)">🟢</button>' +
          '<button class="btn btn-small" data-action="set-class-status" data-id="' + esc(item.id) + '" data-status="learn" title="Mudar para Aprender (Amarelo)">🟡</button>' +
          '<button class="btn btn-small" data-action="set-class-status" data-id="' + esc(item.id) + '" data-status="missed" title="Mudar para Não Vista (Vermelho)">🔴</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function standbyCardHTML(ev) {
    const duration = eventDuration(ev);
    const timeStr = ev.from ? (ev.from + (ev.to ? '–' + ev.to : '') + ' · ') : '';
    return '<div class="class-status-card" style="border-left:4px solid var(--accent,#f59e0b)">' +
      '<div class="pill-row between" style="margin-bottom:8px">' +
        '<span class="status-badge learn">⏳ Em Standby · Aguardando voto hoje</span>' +
        '<small class="muted">Hoje · ' + fmt(ev.date) + '</small>' +
      '</div>' +
      '<h3 style="font-size:15px;margin:0 0 4px;font-weight:750">' + esc(ev.title) + '</h3>' +
      '<p class="muted" style="font-size:12px;margin:0 0 12px">' +
        esc(timeStr + (ev.subject || 'UC2')) + (ev.professor ? ' · ' + esc(ev.professor) : '') + ' · ' + duration + ' min' +
      '</p>' +
      '<p class="tiny muted" style="margin:0 0 10px">Vote agora ou no Fechamento do Dia. Se não houver voto até meia-noite, irá automaticamente para <b>🔴 Não Vistas</b>.</p>' +
      '<div class="pill-row between" style="border-top:1px solid var(--border);padding-top:12px;flex-wrap:wrap;gap:10px">' +
        '<span class="tiny muted">Votar nesta aula:</span>' +
        '<div class="pill-row">' +
          '<button class="btn btn-small" data-action="vote-standby-class" data-event-id="' + esc(ev.id || '') + '" data-date="' + esc(ev.date) + '" data-status="review">🟢 Revisão</button>' +
          '<button class="btn btn-small" data-action="vote-standby-class" data-event-id="' + esc(ev.id || '') + '" data-date="' + esc(ev.date) + '" data-status="learn">🟡 Aprender</button>' +
          '<button class="btn btn-small" data-action="vote-standby-class" data-event-id="' + esc(ev.id || '') + '" data-date="' + esc(ev.date) + '" data-status="missed">🔴 Não vista</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function aulasVotedView() {
    const list = getTrackedClasses();
    const standby = getStandbyClasses();
    const active = list.filter(x => x.status !== 'mastered');
    const masteredCount = list.filter(x => x.status === 'mastered').length;
    const folders = [
      ['review', '🟢 Em Revisão', 'Aulas assistidas'],
      ['learn', '🟡 Precisa Aprender', 'Blocos para aprofundar'],
      ['missed', '🔴 Não Vistas', 'Pendentes de reposição']
    ];
    const byStatus = key => active.filter(x => x.status === key).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (aulaFolder && !folders.some(f => f[0] === aulaFolder)) aulaFolder = null;

    const statsHTML = '<div class="stats">' +
      folders.map(([key, label, hint]) => {
        const n = byStatus(key).length;
        return '<button type="button" class="stat stat-link' + (aulaFolder === key ? ' active' : '') + '" data-action="open-aula-folder" data-folder="' + key + '" aria-pressed="' + (aulaFolder === key) + '">' +
          '<div class="stat-top">' + label + '</div><div class="stat-main">' + n + '</div><div class="stat-hint">' + (aulaFolder === key ? 'Fechar pasta ↑' : n ? 'Abrir pasta ↓' : hint) + '</div></button>';
      }).join('') +
      '<button type="button" class="stat stat-link" data-action="set-review-tab" data-tab="dominadas"><div class="stat-top">🔵 Já Dominadas</div><div class="stat-main">' + masteredCount + '</div><div class="stat-hint">Ver dominadas →</div></button>' +
    '</div>';

    let standbyHTML = '';
    if (standby.length) {
      standbyHTML = panel(
        '⏳ Em Standby · Aulas de Hoje (' + standby.length + ')',
        '<p class="muted" style="margin-bottom:14px">Estas aulas de hoje aguardam sua votação. Se você esquecer de votar até o fim do dia, elas serão movidas automaticamente para <b>🔴 Não Vistas</b> para que nenhuma aula se perca.</p>' +
        standby.map(standbyCardHTML).join(''),
        btn('🌙 Fechar Hoje','open-day-closing','data-date="' + esc(today()) + '"','btn btn-primary btn-small')
      );
    }

    const autoMissedItems = active.filter(x => x.status === 'missed' && x.autoMissed);
    let autoMissedBanner = '';
    if (autoMissedItems.length) {
      const latestAutoDate = autoMissedItems.reduce((m, x) => (x.date && x.date > m ? x.date : m), '');
      autoMissedBanner = '<section class="panel" style="border-color:rgba(239,68,68,0.45);background:rgba(239,68,68,0.04)">' +
        '<div class="pill-row between" style="flex-wrap:wrap;gap:12px">' +
          '<div>' +
            '<strong>🔴 ' + autoMissedItems.length + (autoMissedItems.length === 1 ? ' aula entrou automaticamente em Não Vistas' : ' aulas entraram automaticamente em Não Vistas') + ' (sem voto no fechamento)</strong>' +
            '<p class="tiny muted" style="margin:4px 0 0">Inclui as aulas de <b>' + fmt(latestAutoDate) + '</b> que não foram votadas. Elas já estão salvas como <b>Não Vistas</b>, e você pode mudar o voto para 🟢 Revisão ou 🟡 Aprender quando quiser.</p>' +
          '</div>' +
          '<div class="pill-row">' +
            btn('Abrir pasta 🔴 Não Vistas (' + byStatus('missed').length + ')','open-aula-folder','data-folder="missed"','btn btn-small') +
            btn('🌙 Revisar Fechamento de ' + fmt(latestAutoDate),'open-day-closing','data-date="' + esc(latestAutoDate) + '"','btn btn-primary btn-small') +
          '</div>' +
        '</div>' +
      '</section>';
    }

    let folderHTML = '';
    if (aulaFolder) {
      const f = folders.find(x => x[0] === aulaFolder), rows = byStatus(aulaFolder);
      folderHTML = panel('Pasta ' + f[1] + ' · ' + rows.length,
        rows.length ? rows.map(classCardHTML).join('') : empty('Nenhuma aula nesta pasta.'),
        btn('Fechar','open-aula-folder','data-folder="' + aulaFolder + '"'));
    }

    const lastDate = active.reduce((m, x) => (x.date && x.date > m ? x.date : m), '');
    const dayItems = active.filter(x => x.date === lastDate);
    let contentHTML;
    if (!active.length) {
      contentHTML = empty('Nenhuma aula pendente de revisão ou estudo no momento. Realize o Fechamento do Dia para registrar suas aulas ou confira os conteúdos concluídos na aba Conteúdos Dominados.');
    } else {
      contentHTML = dayItems.map(classCardHTML).join('');
    }
    const archived = active.length - dayItems.length;
    const panelVoted = panel('Aulas do último dia registrado' + (lastDate ? ' · ' + fmt(lastDate) : '') + ' · ' + dayItems.length,
      '<p class="muted" style="margin-bottom:14px">As aulas do último dia com registro (votado ou enviado automaticamente para Não Vistas) ficam em destaque abaixo. Dias anteriores ficam organizados nas pastas acima (Revisão, Aprender, Não vistas)' + (archived ? ' — ' + archived + ' já guardada' + (archived === 1 ? '' : 's') + ' lá' : '') + '. Você pode alterar o voto (🟢, 🟡, 🔴) ou clicar em <b>"Concluir"</b> a qualquer momento.</p>' +
      contentHTML
    );
    return statsHTML + autoMissedBanner + standbyHTML + folderHTML + panelVoted;
  }

  function masteredClassesView() {
    const list = getTrackedClasses();
    const mastered = list.filter(x => x.status === 'mastered').sort((a,b) => String(b.masteredAt||'').localeCompare(String(a.masteredAt||'')));

    const statsHTML = '<div class="stats">' +
      '<div class="stat"><div class="stat-top">Conteúdos Dominados</div><div class="stat-main">' + mastered.length + '</div><div class="stat-hint">Assuntos concluídos com sucesso</div></div>' +
      '<div class="stat"><div class="stat-top">Carga Horária Consolidada</div><div class="stat-main">' + hours(mastered.reduce((s,x)=>s+(x.minutes||90),0)) + '</div><div class="stat-hint">Tempo investido nas aulas</div></div>' +
    '</div>';

    let contentHTML = '';
    if (mastered.length === 0) {
      contentHTML = empty('Você ainda não marcou nenhum conteúdo como concluído. Na aba "Aulas & Cronograma", clique no botão azul "Concluir (Dominei o assunto)" para mover os assuntos dominados para esta caixinha.');
    } else {
      contentHTML = mastered.map(item => {
        const masteredDate = item.masteredAt ? fmt(item.masteredAt.slice(0, 10)) : fmt(item.date);
        return '<div class="class-status-card status-mastered">' +
          '<div class="pill-row between" style="margin-bottom:8px">' +
            '<span class="status-badge mastered">🔵 Concluído · Conteúdo Dominado</span>' +
            '<small class="muted">Concluído em: ' + masteredDate + '</small>' +
          '</div>' +
          '<h3 style="font-size:15px;margin:0 0 4px;font-weight:750">' + esc(item.topic) + '</h3>' +
          '<p class="muted" style="font-size:12px;margin:0 0 10px">' +
            esc(item.subject || 'UC2') + (item.professor ? ' · Prof. ' + esc(item.professor) : '') + ' · ' + (item.minutes || 90) + ' min' +
          '</p>' +
          '<div class="pill-row between" style="border-top:1px solid var(--border);padding-top:10px;font-size:11px;color:var(--muted)">' +
            '<span>📅 <b>Data original da aula:</b> ' + fmt(item.date) + '</span>' +
            '<button class="btn btn-ghost btn-small" data-action="reopen-class-status" data-id="' + esc(item.id) + '">Reabrir para estudos ↻</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    const panelMastered = panel('Histórico de Conteúdos Dominados · ' + mastered.length,
      '<p class="muted" style="margin-bottom:14px">Todo o histórico de aulas e conteúdos que você assistiu, revisou e dominou fica registrado aqui permanentemente com a data original da aula e o momento da conclusão.</p>' +
      contentHTML
    );

    return statsHTML + panelMastered;
  }

  reviewView = function() {
    if(personalAccount())activeReviewTab=window.AccountFeatureData?.reviewTab()||'flashcards';
    const header = reviewTabsHeader();
    if (activeReviewTab === 'aulas') {
      return header + aulasVotedView();
    }
    if (activeReviewTab === 'dominadas') {
      return header + masteredClassesView();
    }
    return header + overview();
  };
  function showDay(date){
    const day=state.summary?.days.find(x=>x.date===date);if(!day)return;
    const totals={again:0,hard:0,good:0,easy:0};
    day.distribution.forEach(group=>Object.keys(totals).forEach(key=>totals[key]+=group.ratings[key]||0));
    const rows=day.distribution.map(group=>{
      const parts=group.path.split(' / '),title=parts.pop(),pct=Math.round(group.count/day.count*100);
      return '<section class="medreview-distribution"><p class="mr-breadcrumb">'+esc(parts.join(' / ')||'Baralho')+'</p><div class="mr-distribution-heading"><h3>'+esc(title)+'</h3><strong>'+pct+'% <small>do dia</small></strong></div><div class="mr-share mr-track"><span style="width:'+group.count/day.count*100+'%"></span></div><div class="pill-row">'+tag(group.count+' revisões')+tag(group.uniqueCards+' cartões distintos','gray')+'</div>'+ratingBars(group.ratings,group.count)+'</section>';
    }).join('');
    $('modal').innerHTML='<div class="modal-card medreview-detail" role="dialog" aria-modal="true" aria-labelledby="medreview-detail-title"><button type="button" class="close" data-action="close" aria-label="Fechar">×</button><span class="mr-eyebrow">Seu estudo em detalhes</span><h2 id="medreview-detail-title">Flashcards · '+formatDay(day.date)+'</h2><div class="mr-detail-summary"><div><strong>'+day.count+'</strong><span>Revisões realizadas</span></div><div><strong>'+day.uniqueCards+'</strong><span>Cartões distintos</span></div><div><strong>'+day.distribution.length+'</strong><span>Baralhos revisados</span></div></div><section class="mr-day-ratings"><h3>Como você avaliou as respostas</h3><p class="tiny">Estas são as avaliações escolhidas no MedReview; não representam uma nota de prova ou taxa de acerto.</p>'+ratingBars(totals,day.count)+'</section><h3>De onde vieram as revisões</h3><div class="mr-distribution-grid">'+rows+'</div><p class="tiny">Distribuição pelo baralho atual do cartão. Cartões removidos ou sem acesso aparecem como baralho não identificado. São contabilizadas apenas revisões da sua conta registradas pelo MedReview.</p></div>';
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
    if(error||!identity.user){clearSession();fail(navigator.onLine?'A sessão do MedReview expirou. Conecte sua conta novamente.':'Sem internet para consultar o MedReview. A conexão será retomada quando você estiver online.');return}
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
      case'set-review-tab':
        activeReviewTab=button.dataset.tab;
        window.AccountFeatureData?.setReviewTab(activeReviewTab)
        render();
        break;
      case'open-aula-folder':
        aulaFolder = aulaFolder === button.dataset.folder ? null : button.dataset.folder;
        render();
        break;
      case'mark-class-mastered':
        setClassStatus(button.dataset.id, 'mastered');
        break;
      case'set-class-status':
        setClassStatus(button.dataset.id, button.dataset.status);
        break;
      case'reopen-class-status':
        setClassStatus(button.dataset.id, 'review');
        break;
      case'vote-standby-class':
        voteStandbyClass(button.dataset.eventId, button.dataset.date, button.dataset.status);
        break;
      case'open-aulas-missed':
        activeReviewTab='aulas';
        window.AccountFeatureData?.setReviewTab('aulas');
        aulaFolder='missed';
        goto('reviews');
        break;
    }
  });
  window.addEventListener('online',async()=>{try{if(client){const {data:auth}=await client.auth.getSession();if(auth.session)await acceptSession(auth.session)}}catch{fail('Não foi possível retomar o MedReview. Tente atualizar o histórico novamente.')}});
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
  window.MedReviewConnection={get status(){return state.status},get summary(){return state.summary},sync,disconnect(){clearSession();return client?.auth.signOut({scope:'local'})}};
  initialize();render();
})();
