const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.NOTION_TOKEN;
  const dbId = '2a7257fa1555812a9776ea48f5868127';

  if (!token) return res.status(500).json({ error: 'NOTION_TOKEN manquant' });

  try {
    let allResults = [];
    let hasMore = true;
    let cursor = undefined;

    while (hasMore) {
      const body = JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 });

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

      allResults = allResults.concat(data.results || []);
      hasMore = data.has_more;
      cursor = data.next_cursor;
    }

    const clients = allResults
      .map(page => {
        const p = page.properties;
        const projet = (p['Projet']?.title || [])[0]?.plain_text || '';
        const marque = (p['Marque']?.rich_text || [])[0]?.plain_text || '';
        const nom = projet.replace(/\(.*?\)/g, '').replace(/-\s*$/, '').trim();
        const email = (p['Email']?.email) || '';
        const tel = (p['Téléphone']?.phone_number) || '';
        const adresse = (p['Adresse siège social']?.rich_text || []).map(t => t.plain_text).join('').split('\n')[0] || '';
        return { marque, nom, email, tel, adresse };
      })
      .filter(c => c.marque || c.nom)
      .sort((a, b) => (a.marque || a.nom).localeCompare(b.marque || b.nom));

    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({ clients });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
