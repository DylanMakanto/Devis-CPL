const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID = '311257fa155580d3bb51000bd38bdcae';

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'Token Notion non configuré' });
  }

  try {
    let allResults = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = JSON.stringify(
        startCursor ? { page_size: 100, start_cursor: startCursor } : { page_size: 100 }
      );

      const data = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.notion.com',
          path: `/v1/databases/${DATABASE_ID}/query`,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        };
        const req = https.request(options, (r) => {
          let raw = '';
          r.on('data', chunk => raw += chunk);
          r.on('end', () => {
            try { resolve(JSON.parse(raw)); }
            catch (e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });

      if (data.object === 'error') {
        return res.status(400).json({ error: data.message });
      }

      allResults = allResults.concat(data.results || []);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    const offers = allResults.map(page => {
      const props = page.properties;
      const nom = props['Offres']?.title?.[0]?.plain_text || '';
      const type = props['Type']?.select?.name || '';
      const prix = props['Prix HT']?.number ?? 0;
      const descRaw = (props['Description']?.rich_text || []).map(t => t.plain_text).join('');
      const desc = descRaw
        .split('\n')
        .find(l => l.trim().length > 0)
        ?.replace(/^[-•·]\s*/, '')
        .trim()
        .substring(0, 100) || '';
      return { n: nom, t: type, p: prix, d: desc };
    }).filter(o => o.n && o.t);

    const seenNames = new Set();
    const deduped = offers
      .sort((a, b) => (b.d || '').length - (a.d || '').length)
      .filter(o => {
        if (seenNames.has(o.n)) return false;
        seenNames.add(o.n);
        return true;
      });

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ offers: deduped });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
