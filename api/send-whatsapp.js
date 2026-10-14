export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use o botão de envio no aplicativo.' });

  const url = process.env.PLANNING_SUPABASE_URL || 'https://eupkdyhngmrsbvmaondp.supabase.co';
  const publicKey = process.env.PLANNING_SUPABASE_PUBLIC_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1cGtkeWhuZ21yc2J2bWFvbmRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5Mzg1NDgsImV4cCI6MjEwNzUxNDU0OH0.1xR4XzSI0ijjWKpGbr3zflz3DAFwORTxLgZtaBhkrU8';

  const authorization = req.headers.authorization || '';

  // Autenticação básica ou validação
  let isAdminUser = false;
  if (authorization.startsWith('Bearer ')) {
    try {
      const headers = { Authorization: authorization, apikey: publicKey };
      const identity = await fetch(url + '/auth/v1/user', { headers, signal: AbortSignal.timeout(8000) });
      if (identity.ok) {
        const user = await identity.json();
        const email = (user.email || '').toLowerCase();
        if (
          user.id === 'ab049488-5127-4db2-b093-c397e8ea17b1' ||
          user.id === '2c337bd5-b283-4ce8-9c0a-c817e4cdd697' ||
          email.includes('gabriel')
        ) {
          isAdminUser = true;
        }
      }
    } catch (e) {
      // Se a verificação externa falhar mas os dados forem fornecidos, continua
    }
  }

  const phone = String(req.body?.phone || '556599882979').replace(/\D/g, '');
  const text = String(req.body?.text || '').trim();
  const apikey = String(req.body?.apikey || '4304674').trim();

  if (!phone || !apikey || !text) {
    return res.status(400).json({ error: 'Parâmetros phone, apikey ou text ausentes.' });
  }

  try {
    const query = new URLSearchParams({ phone, text, apikey });
    const upstream = await fetch('https://api.callmebot.com/whatsapp.php?' + query, { signal: AbortSignal.timeout(15000) });
    const response = await upstream.text();
    return res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso!' });
  } catch (err) {
    return res.status(502).json({ error: 'Erro ao conectar ao CallMeBot: ' + err.message });
  }
}
