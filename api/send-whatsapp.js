import {verifiedOwner} from '../server/account-access.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use o botão de envio no aplicativo.' });

  try{await verifiedOwner(req)}catch(error){return res.status(error.status||503).json({error:error.status===403?'Recurso reservado à conta administradora aprovada.':'Entre novamente ou tente mais tarde.'})}
  const phone=String(req.body?.phone||process.env.PLANNING_OWNER_WHATSAPP_PHONE||'').replace(/\D/g,'');
  const text = String(req.body?.text || '').trim();
  const apikey=String(req.body?.apikey||process.env.PLANNING_OWNER_WHATSAPP_KEY||'').trim();

  if (!/^\d{10,15}$/.test(phone) || !/^\d{4,30}$/.test(apikey) || !text || text.length>14000) {
    return res.status(400).json({ error: 'Parâmetros phone, apikey ou text ausentes.' });
  }

  try {
    const query = new URLSearchParams({ phone, text, apikey });
    const upstream = await fetch('https://api.callmebot.com/whatsapp.php?' + query, { signal: AbortSignal.timeout(15000) });
    const response = await upstream.text();
    if(!upstream.ok||/\bERROR\b|invalid apikey/i.test(response))return res.status(502).json({error:'O CallMeBot não confirmou o envio.'});
    return res.status(200).json({ success: true, message: 'Mensagem enviada com sucesso!' });
  } catch (err) {
    return res.status(502).json({ error: 'Não foi possível conectar ao CallMeBot.' });
  }
}
