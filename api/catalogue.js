export default async function handler(req, res) {
  // CORS — autorise uniquement ton domaine Vercel
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const NOTION_TOKEN = process.env.NOTION_TOKEN;
  const DATABASE_ID = '311257fa-1555-80d3-bb51-000bd38bdcae';

  if (!NOTION_TOKEN) {
    return res.status(500).json({ error: 'Token Notion non configuré' });
  }

  try {
    // Récupère toutes les entrées du catalogue Notion
    let allResults = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const body = { page_size: 100 };
      if (startCursor) body.start_cursor = startCursor;

      const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        return res.status(response.status).json({ error: err.message });
      }

      const data = await response.json();
      allResults = allResults.concat(data.results);
      hasMore = data.has_more;
      startCursor = data.next_cursor;
    }

    // Transforme les résultats Notion en format simplifié
    const offers = allResults
      .map(page => {
        const props = page.properties;
        const nom = props['Offres']?.title?.[0]?.plain_text || '';
        const type = props['Type']?.select?.name || '';
        const prix = props['Prix HT']?.number ?? 0;
        const descRaw = props['Description']?.rich_text?.map(t => t.plain_text).join('') || '';
        // Description courte : première ligne, max 100 chars
        const desc = descRaw.split('\n').find(l => l.trim().length > 0)?.replace(/^[-•]\s*/, '').trim().substring(0, 100) || '';
        return { n: nom, t: type, p: prix, d: desc };
      })
      .filter(o => o.n && o.t); // filtre les entrées vides

    // Déduplique par nom (garde celle avec description si doublon)
    const seenNames = new Set();
    const deduped = offers
      .sort((a, b) => (b.d || '').length - (a.d || '').length)
      .filter(o => {
        if (seenNames.has(o.n)) return false;
        seenNames.add(o.n);
        return true;
      });

    // Cache 5 minutes côté Vercel
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ offers: deduped });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
