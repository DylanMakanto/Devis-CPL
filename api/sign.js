const https = require('https');

function apiRequest(method, path, body, apiKey) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api-sandbox.yousign.app',
      path,
      method,
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

// Upload PDF via multipart/form-data (format attendu par YouSign v3)
function uploadPDF(pdfBuffer, filename, apiKey) {
  return new Promise((resolve, reject) => {
    const boundary = '----CPLBoundary' + Date.now().toString(16);
    const CRLF = '\r\n';

    // Construire le corps multipart
    let pre = '';
    pre += '--' + boundary + CRLF;
    pre += 'Content-Disposition: form-data; name="nature"' + CRLF + CRLF;
    pre += 'signable_document' + CRLF;
    pre += '--' + boundary + CRLF;
    pre += 'Content-Disposition: form-data; name="file"; filename="' + filename + '"' + CRLF;
    pre += 'Content-Type: application/pdf' + CRLF + CRLF;

    const post = CRLF + '--' + boundary + '--' + CRLF;

    const preBuffer = Buffer.from(pre, 'utf8');
    const postBuffer = Buffer.from(post, 'utf8');
    const totalLength = preBuffer.length + pdfBuffer.length + postBuffer.length;

    const options = {
      hostname: 'api-sandbox.yousign.app',
      path: '/v3/documents',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': totalLength
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
    req.write(preBuffer);
    req.write(pdfBuffer);
    req.write(postBuffer);
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
    const { pdfBase64, signerName, signerEmail, devisNumber, clientName, emailSubject, emailMessage, senderName } = req.body;

    if (!pdfBase64 || !signerEmail || !signerName) {
      return res.status(400).json({ error: 'Données manquantes : pdfBase64, signerName, signerEmail requis' });
    }

    const filename = `Devis_CPL_${(clientName||'Client').replace(/\s+/g,'_')}_${devisNumber||'XXX'}.pdf`;

    // Convertir base64 en Buffer binaire
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');

    // 1. Upload PDF en multipart/form-data
    const uploadRes = await uploadPDF(pdfBuffer, filename, YOUSIGN_API_KEY);
    if (uploadRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur upload YouSign', detail: uploadRes.body });
    }
    const documentId = uploadRes.body.id;

    // 2. Créer la demande de signature
    const prenom = signerName.split(' ')[0] || signerName;
    const nom = signerName.split(' ').slice(1).join(' ') || '.';
    const srName = emailSubject || `Devis ${devisNumber||''} — ${clientName||signerName}`;

    const srPayload = {
      name: srName,
      delivery_mode: 'email',
      timezone: 'Europe/Paris',
      documents: [{ document_id: documentId }],
      signers: [{
        info: {
          first_name: prenom,
          last_name: nom,
          email: signerEmail,
          locale: 'fr'
        },
        signature_level: 'electronic_signature',
        signature_authentication_mode: 'no_otp',
        fields: [{
          document_id: documentId,
          type: 'signature',
          page: 1,
          x: 390,
          y: 680,
          width: 160,
          height: 55
        }]
      }]
    };

    if (emailMessage || senderName) {
      srPayload.email_notification = {};
      if (senderName) srPayload.email_notification.sender = { name: senderName };
      if (emailMessage) srPayload.email_notification.custom_note = emailMessage;
    }

    const srRes = await apiRequest('POST', '/v3/signature_requests', srPayload, YOUSIGN_API_KEY);
    if (srRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur création demande', detail: srRes.body });
    }
    const signatureRequestId = srRes.body.id;

    // 3. Activer (envoi email au client)
    const activateRes = await apiRequest('POST', `/v3/signature_requests/${signatureRequestId}/activate`, null, YOUSIGN_API_KEY);
    if (activateRes.status !== 200 && activateRes.status !== 201) {
      return res.status(500).json({ error: 'Erreur activation', detail: activateRes.body });
    }

    return res.status(200).json({ success: true, signatureRequestId, signerEmail });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
