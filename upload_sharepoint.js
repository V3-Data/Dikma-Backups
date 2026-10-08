const fs = require('fs');
const path = require('path');

const TENANT_ID = process.env.SHAREPOINT_TENANT_ID;
const CLIENT_ID = process.env.SHAREPOINT_CLIENT_ID;
const CLIENT_SECRET = process.env.SHAREPOINT_CLIENT_SECRET;
const SITE_URL = process.env.SHAREPOINT_SITE_URL; // ex: https://contoso.sharepoint.com/sites/mysite
const REMOTE_FOLDER = process.env.SHAREPOINT_REMOTE_FOLDER || 'Backups/Supabase';
const LOCAL_FILE = process.env.LOCAL_BACKUP_FILE;

async function getToken() {
  const res = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    }
  );
  const data = await res.json();
  if (!data.access_token) throw new Error(`Falha ao obter token: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function getSiteId(token) {
  const url = new URL(SITE_URL);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${url.hostname}:${url.pathname}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (!data.id) throw new Error(`Site não encontrado: ${JSON.stringify(data)}`);
  return data.id;
}

async function uploadFile(token, siteId, localFile, remotePath) {
  const stats = fs.statSync(localFile);
  const fileSize = stats.size;
  const fileName = path.basename(localFile);
  const graphPath = `${remotePath}/${fileName}`;

  console.log(`Iniciando upload: ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  // Criar sessão de upload — suporta arquivos de qualquer tamanho
  const sessionRes = await fetch(
    `https://graph.microsoft.com/v1.0/sites/${siteId}/drive/root:/${graphPath}:/createUploadSession`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        item: { '@microsoft.graph.conflictBehavior': 'replace', name: fileName },
      }),
    }
  );
  const session = await sessionRes.json();
  if (!session.uploadUrl) throw new Error(`Erro ao criar sessão: ${JSON.stringify(session)}`);

  // Upload em chunks de 10 MB
  const CHUNK_SIZE = 10 * 1024 * 1024;
  const fd = fs.openSync(localFile, 'r');
  let offset = 0;

  while (offset < fileSize) {
    const end = Math.min(offset + CHUNK_SIZE, fileSize);
    const chunk = Buffer.alloc(end - offset);
    fs.readSync(fd, chunk, 0, chunk.length, offset);

    const chunkRes = await fetch(session.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Length': String(chunk.length),
        'Content-Range': `bytes ${offset}-${end - 1}/${fileSize}`,
        'Content-Type': 'application/octet-stream',
      },
      body: chunk,
    });

    if (![200, 201, 202].includes(chunkRes.status)) {
      const body = await chunkRes.text();
      throw new Error(`Erro no chunk ${offset}-${end - 1}: ${chunkRes.status} ${body}`);
    }

    console.log(`Progresso: ${end}/${fileSize} bytes (${Math.round((end / fileSize) * 100)}%)`);
    offset = end;
  }

  fs.closeSync(fd);
  console.log(`Upload concluído: ${graphPath}`);
}

async function main() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET || !SITE_URL || !LOCAL_FILE) {
    console.error('Erro: variáveis de ambiente obrigatórias não definidas.');
    process.exit(1);
  }

  const token = await getToken();
  const siteId = await getSiteId(token);
  const date = process.env.TODAY_DATE;
  const remotePath = `${REMOTE_FOLDER}/${date}`;

  await uploadFile(token, siteId, LOCAL_FILE, remotePath);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
