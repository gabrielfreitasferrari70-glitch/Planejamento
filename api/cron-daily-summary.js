import {ownerDocument,authorizeCron} from '../server/account-access.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control','private, no-store');
  const authorization=authorizeCron(req);
  if(authorization)return res.status(authorization).json({error:'Acesso reservado ao agendamento autorizado.'});
  const type=req.query.type||'morning';
  if(!['morning','night'].includes(type))return res.status(400).json({error:'Tipo de resumo inválido.'});
  const phone=process.env.PLANNING_OWNER_WHATSAPP_PHONE;
  const apikey=process.env.PLANNING_OWNER_WHATSAPP_KEY;
  if(!phone||!apikey)return res.status(503).json({error:'Configuração do WhatsApp indisponível.'});

  const zone = 'America/Cuiaba';
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);

  const dateFormatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(todayStr + 'T12:00:00Z'));

  // Read only the approved administrator's private semester and commitments.
  let academic=[];
  try {
    const document=await ownerDocument();
    academic=[...(document.payload?.replacement||[]),...(document.payload?.events||[])];
  } catch(error){return res.status(error.status||503).json({error:'Não foi possível ler o cronograma da conta administradora.'})}

  const todayEvents = academic.filter(x => x.date === todayStr && !['free', 'break'].includes(x.type));

  let message = '';

  if (type === 'morning') {
    let lines = [
      `🌅 *Bom dia, Gabriel!*`,
      `📋 *Planejamento Medicina · Cronograma de Hoje*`,
      `📅 _${dateFormatted}_\n`
    ];

    lines.push(`⏰ *AULAS E COMPROMISSOS PREVISTOS (${todayEvents.length}):*`);
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
    lines.push(`🔗 Acesse seu Planejamento: https://planejamento-medicina-independente.vercel.app`);
    message = lines.join('\n');
  } else {
    // Night
    let lines = [
      `🌙 *Boa noite, Gabriel!*`,
      `📋 *Fechamento do Dia · Planejamento Medicina*`,
      `📅 _${dateFormatted}_\n`
    ];

    lines.push(`⏰ *AULAS PREVISTAS HOJE (${todayEvents.length}):*`);
    if (todayEvents.length === 0) {
      lines.push('• _Nenhuma aula agendada no cronograma de hoje._');
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
    message = lines.join('\n');
  }

  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apikey)}`;
    const upstream = await fetch(url,{signal:AbortSignal.timeout(20000)});
    const body = await upstream.text();
    if(!upstream.ok||/\bERROR\b|invalid apikey/i.test(body))return res.status(502).json({error:'O envio não foi confirmado pelo CallMeBot.'});
    return res.status(200).json({
      success: true,
      type,
      today: todayStr
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Não foi possível concluir o disparo do WhatsApp.'
    });
  }
}
