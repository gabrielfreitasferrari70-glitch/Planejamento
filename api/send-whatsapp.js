export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const phone = req.query.phone || (req.body && req.body.phone);
  const text = req.query.text || (req.body && req.body.text);
  const apikey = req.query.apikey || (req.body && req.body.apikey);

  if (!phone || !text || !apikey) {
    return res.status(400).json({ error: 'Parâmetros phone, text ou apikey ausentes' });
  }

  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(apikey)}`;
    const upstream = await fetch(url);
    const body = await upstream.text();
    return res.status(200).json({ success: true, message: 'Enviado com sucesso', upstreamBody: body });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Erro ao contatar CallMeBot' });
  }
}
