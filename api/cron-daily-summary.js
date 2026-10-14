import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

  const type = req.query.type || 'morning'; // 'morning' ou 'night'
  const phone = '556599882979';
  const apikey = '4304674';

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

  // Carrega eventos acadêmicos
  let academic = [];
  try {
    const filePath = path.join(process.cwd(), 'academic.json');
    if (fs.existsSync(filePath)) {
      academic = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error('Erro ao ler academic.json:', err);
  }

  const todayEvents = academic.filter(x => x.date === todayStr);

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
    const upstream = await fetch(url);
    const body = await upstream.text();
    return res.status(200).json({
      success: true,
      type,
      today: todayStr,
      upstreamBody: body
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || 'Erro ao disparar WhatsApp'
    });
  }
}
