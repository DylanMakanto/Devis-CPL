const https = require('https');

function apiRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api-sandbox.yousign.app',
      path,
      method,
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' }
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch(e) { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function uploadFile(fileBuffer, filename, nature, apiKey) {
  return new Promise((resolve, reject) => {
    const boundary = '----CPLBoundary' + Date.now().toString(16) + Math.random().toString(16).slice(2);
    const CRLF = '\r\n';
    let pre = '--' + boundary + CRLF;
    pre += 'Content-Disposition: form-data; name="nature"' + CRLF + CRLF;
    pre += nature + CRLF;
    pre += '--' + boundary + CRLF;
    pre += 'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + CRLF;
    pre += 'Content-Type: application/pdf' + CRLF + CRLF;
    const post = CRLF + '--' + boundary + '--' + CRLF;
    const preBuffer = Buffer.from(pre, 'utf8');
    const postBuffer = Buffer.from(post, 'utf8');
    const options = {
      hostname: 'api-sandbox.yousign.app',
      path: '/v3/documents',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': preBuffer.length + fileBuffer.length + postBuffer.length
      }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); } catch(e) { resolve({ status: res.statusCode, body: raw }); } });
    });
    req.on('error', reject);
    req.write(preBuffer);
    req.write(fileBuffer);
    req.write(postBuffer);
    req.end();
  });
}

// URL publique de la plaquette CPL — à mettre à jour avec le vrai lien
const PLAQUETTE_URL = process.env.PLAQUETTE_URL || '';

async function fetchPlaquette() {
  if (!PLAQUETTE_URL) return null;
  return new Promise((resolve) => {
    const url = new URL(PLAQUETTE_URL);
    const lib = url.protocol === 'https:' ? https : require('http');
    lib.get(PLAQUETTE_URL, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    }).on('error', () => resolve(null));
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
    const { pdfBase64, signerName, signerEmail, devisNumber, clientName, emailSubject } = req.body;

    if (!pdfBase64 || !signerEmail || !signerName) {
      return res.status(400).json({ error: 'Données manquantes' });
    }

    const filename = 'Devis_CPL_' + (clientName||'Client').replace(/\s+/g,'_') + '_' + (devisNumber||'XXX') + '.pdf';
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    // 1. Upload devis PDF (signable)
    const uploadRes = await uploadFile(pdfBuffer, filename, 'signable_document', YOUSIGN_API_KEY);
    if (uploadRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur upload devis', detail: uploadRes.body });
    }
    const documentId = uploadRes.body.id;

    // 2. Upload plaquette CPL (annexe non signable) si disponible
    const documentsList = [documentId];
    const plaquetteBuffer = await fetchPlaquette();
    if (plaquetteBuffer) {
      const plaqRes = await uploadFile(plaquetteBuffer, 'Plaquette_CPL.pdf', 'attachment', YOUSIGN_API_KEY);
      if (plaqRes.status === 201) {
        documentsList.push(plaqRes.body.id);
      }
    }

    // 3. Créer la demande de signature
    const parts = signerName.trim().split(' ');
    const prenom = parts[0] || 'Client';
    const nom = parts.slice(1).join(' ') || 'CPL';
    const srName = (emailSubject || ('Devis ' + (devisNumber||'') + ' - ' + (clientName||signerName))).substring(0, 100);

    const srPayload = {
      name: srName,
      delivery_mode: 'email',
      timezone: 'Europe/Paris',
      documents: documentsList,
      signers: [{
        info: { first_name: prenom, last_name: nom, email: signerEmail, locale: 'fr' },
        signature_level: 'electronic_signature',
        signature_authentication_mode: 'no_otp',
        fields: [{
          document_id: documentId,
          type: 'signature',
          page: 1,
          x: 390, y: 680, width: 160, height: 55
        }]
      }]
    };

    const srRes = await apiRequest('POST', '/v3/signature_requests', srPayload, YOUSIGN_API_KEY);
    if (srRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur création demande', detail: srRes.body });
    }
    const signatureRequestId = srRes.body.id;

    // 4. Activer (envoi email)
    const activateRes = await apiRequest('POST', '/v3/signature_requests/' + signatureRequestId + '/activate', null, YOUSIGN_API_KEY);
    if (activateRes.status !== 200 && activateRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur activation', detail: activateRes.body });
    }

    return res.status(200).json({ success: true, signatureRequestId, signerEmail, plaquetteJointe: !!plaquetteBuffer });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
