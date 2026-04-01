const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  const dbId = 'de4dcddc1e8f42a7829e41a3da77b4b2';

  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN manquant' });

  try {
    const body = JSON.stringify({ page_size: 100 });

    const data = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.notion.com',
        path: `/v1/databases/${dbId}/query`,
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      };
      const request = https.request(options, (r) => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
      });
      request.on('error', reject);
      request.write(body);
      request.end();
    });

    if (data.object === 'error') return res.status(400).json({ error: data.message });

    const commerciaux = (data.results || [])
      .map(page => {
        const p = page.properties;
        const nom = (p['Nom']?.title || [])[0]?.plain_text || '';
        const prenom = (p['Prénom']?.rich_text || [])[0]?.plain_text || '';
        const email = p['Email']?.email || '';
        const role = p['Rôle']?.select?.name || '';
        const actif = p['Actif']?.checkbox ?? true;
        const label = prenom && prenom !== nom ? `${prenom} ${nom}` : prenom || nom;
        return { label, email, role, actif };
      })
      .filter(c => c.label && c.actif)
      .sort((a, b) => a.label.localeCompare(b.label));

    res.setHeader('Cache-Control', 's-maxage=0, no-cache');
    return res.status(200).json({ commerciaux });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
