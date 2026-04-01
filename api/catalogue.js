const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.NOTION_TOKEN;
  const dbId = '311257fa1555804fbe2beb7539bb0407';

  if (!token) {
    return res.status(500).json({ error: 'NOTION_TOKEN manquant' });
  }

  try {
    const body = JSON.stringify({ page_size: 100 });

    const notionData = await new Promise((resolve, reject) => {
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

      const request = https.request(options, (response) => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Parse error: ' + data.substring(0, 200)));
          }
        });
      });

      request.on('error', reject);
      request.write(body);
      request.end();
    });

    if (!notionData.results) {
      return res.status(500).json({ error: 'Réponse Notion invalide', detail: notionData });
    }

    const offers = notionData.results
      .map(page => {
        const p = page.properties;
        const nom = (p['Offres']?.title || [])[0]?.plain_text || '';
        const type = p['Type']?.select?.name || '';
        const prix = p['Prix HT']?.number ?? 0;
        const descRaw = (p['Description']?.rich_text || []).map(t => t.plain_text).join('');
        const desc = descRaw.split('\n').find(l => l.trim())?.replace(/^[-•·]\s*/, '').trim().slice(0, 500) || '';
        return { n: nom, t: type, p: prix, d: desc };
      })
      .filter(o => o.n && o.t);

    const seen = new Set();
    const deduped = offers
      .sort((a, b) => b.d.length - a.d.length)
      .filter(o => seen.has(o.n) ? false : !!seen.add(o.n));

    res.setHeader('Cache-Control', 's-maxage=0, no-cache');
    return res.status(200).json({ offers: deduped });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
