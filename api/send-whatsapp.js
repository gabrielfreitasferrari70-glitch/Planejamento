export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use o botão de envio no aplicativo.' });
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) return res.status(401).json({ error: 'Entre na sua conta para enviar.' });
  const url = process.env.PLANNING_SUPABASE_URL;
  const publicKey = process.env.PLANNING_SUPABASE_PUBLIC_KEY;
  if (!url || !publicKey) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
  try {
    const headers = { Authorization: authorization, apikey: publicKey };
    const identity = await fetch(url + '/auth/v1/user', { headers, signal: AbortSignal.timeout(10000) });
    if (!identity.ok) return res.status(401).json({ error: 'Entre novamente na sua conta.' });
    const user = await identity.json();
    if (!user.id) return res.status(401).json({ error: 'Sessão inválida.' });
    const profile = await fetch(url + '/rest/v1/profiles?select=approved&id=eq.' + encodeURIComponent(user.id), { headers, signal: AbortSignal.timeout(10000) });
    if (!profile.ok) return res.status(503).json({ error: 'Não foi possível verificar a aprovação.' });
    const rows = await profile.json();
    if (rows[0]?.approved !== true) return res.status(403).json({ error: 'Sua conta aguarda aprovação.' });
    const phone = String(req.body?.phone || '').replace(/\D/g, '');
    const text = String(req.body?.text || '').trim();
    let apikey = String(req.body?.apikey || '').trim();
    if (!apikey && user.id === process.env.PLANNING_OWNER_ID && phone === process.env.PLANNING_OWNER_WHATSAPP_PHONE) apikey = process.env.PLANNING_OWNER_WHATSAPP_KEY || '';
    if (!/^\d{10,15}$/.test(phone) || !/^\d{4,30}$/.test(apikey) || !text || text.length > 14000) return res.status(400).json({ error: 'Confira seu número, chave CallMeBot e tamanho do resumo.' });
    const query = new URLSearchParams({ phone, text, apikey });
    const upstream = await fetch('https://api.callmebot.com/whatsapp.php?' + query, { signal: AbortSignal.timeout(20000) });
    const response = await upstream.text();
    if (!upstream.ok || /\bERROR\b|invalid apikey/i.test(response)) return res.status(502).json({ error: 'O CallMeBot não confirmou o envio. Confira sua configuração.' });
    return res.status(200).json({ success: true });
  } catch {
    return res.status(503).json({ error: 'Não foi possível concluir o envio. Tente novamente.' });
  }
}
