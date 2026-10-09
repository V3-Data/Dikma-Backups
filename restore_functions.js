const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const FUNCTIONS_DIR = process.argv[2];

if (!ACCESS_TOKEN || !SUPABASE_URL || !FUNCTIONS_DIR) {
  console.error('Uso: SUPABASE_ACCESS_TOKEN=... SUPABASE_URL=... node restore_functions.js <functions_dir>');
  process.exit(1);
}

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const API_BASE = 'https://api.supabase.com/v1';

async function deployFunction(slug, zipPath) {
  const body = fs.readFileSync(zipPath);

  // Tenta atualizar função existente
  let res = await fetch(`${API_BASE}/projects/${PROJECT_REF}/functions/${slug}/body`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/zip',
    },
    body,
  });

  if (res.ok) {
    console.log(`  OK: ${slug} (atualizada)`);
    return;
  }

  if (res.status !== 404) {
    const text = await res.text();
    console.error(`  Erro: ${slug} — PUT ${res.status}: ${text}`);
    return;
  }

  // Função não existe — cria com body em base64
  res = await fetch(`${API_BASE}/projects/${PROJECT_REF}/functions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      slug,
      name: slug,
      body: body.toString('base64'),
      verify_jwt: true,
    }),
  });

  if (res.ok) {
    console.log(`  OK: ${slug} (criada)`);
  } else {
    const text = await res.text();
    console.error(`  Erro ao criar ${slug} — POST ${res.status}: ${text}`);
  }
}

async function main() {
  const indexPath = path.join(FUNCTIONS_DIR, 'index.json');

  if (!fs.existsSync(indexPath)) {
    console.log('Sem Edge Functions no backup — ignorando.');
    return;
  }

  const functions = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

  for (const fn of functions) {
    const zipPath = path.join(FUNCTIONS_DIR, `${fn.slug}.zip`);
    if (!fs.existsSync(zipPath)) {
      console.log(`  ZIP não encontrado para ${fn.slug} — ignorando.`);
      continue;
    }
    console.log(`  Implantando: ${fn.slug}`);
    await deployFunction(fn.slug, zipPath);
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
