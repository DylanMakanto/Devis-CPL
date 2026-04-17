const https = require('https');

function apiRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api-sandbox.yousign.app',
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadRequest(pdfBase64, filename, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      name: filename,
      content: pdfBase64,
      nature: 'signable_document'
    });
    const options = {
      hostname: 'api-sandbox.yousign.app',
      path: '/v3/documents',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });

  const YOUSIGN_API_KEY = process.env.YOUSIGN_API_KEY;
  if (!YOUSIGN_API_KEY) return res.status(500).json({ error: 'YOUSIGN_API_KEY manquant' });

  try {
    const { pdfBase64, signerName, signerEmail, devisNumber, clientName } = req.body;

    if (!pdfBase64 || !signerEmail || !signerName) {
      return res.status(400).json({ error: 'Données manquantes : pdfBase64, signerName, signerEmail requis' });
    }

    const filename = `Devis_CPL_${(clientName||'Client').replace(/\s+/g,'_')}_${devisNumber||'XXX'}.pdf`;

    // 1. Upload du document PDF
    const uploadRes = await uploadRequest(pdfBase64, filename, YOUSIGN_API_KEY);
    if (uploadRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur upload document YouSign', detail: uploadRes.body });
    }
    const documentId = uploadRes.body.id;

    // 2. Créer la demande de signature
    const srRes = await apiRequest('POST', '/v3/signature_requests', {
      name: `Devis ${devisNumber || ''} — ${clientName || signerName}`,
      delivery_mode: 'email',
      timezone: 'Europe/Paris',
      documents: [{ document_id: documentId }],
      signers: [{
        info: {
          first_name: signerName.split(' ')[0] || signerName,
          last_name: signerName.split(' ').slice(1).join(' ') || '.',
          email: signerEmail,
          locale: 'fr'
        },
        signature_level: 'electronic_signature',
        signature_authentication_mode: 'no_otp',
        fields: [{
          document_id: documentId,
          type: 'signature',
          page: 1,
          x: 400,
          y: 700,
          width: 150,
          height: 50
        }]
      }]
    }, YOUSIGN_API_KEY);

    if (srRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur création demande signature', detail: srRes.body });
    }

    const signatureRequestId = srRes.body.id;

    // 3. Activer la demande (envoi de l'email au client)
    const activateRes = await apiRequest('POST', `/v3/signature_requests/${signatureRequestId}/activate`, null, YOUSIGN_API_KEY);
    if (activateRes.status !== 200 && activateRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur activation demande signature', detail: activateRes.body });
    }

    return res.status(200).json({
      success: true,
      signatureRequestId,
      signerEmail,
      message: `Demande de signature envoyée à ${signerEmail}`
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
