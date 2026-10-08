const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const OUTPUT_DIR = process.env.OUTPUT_CONFIG_DIR || './config';

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const API_BASE = 'https://api.supabase.com/v1';

async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${endpoint} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function saveJson(filename, data) {
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
  console.log(`  Salvo: ${filename}`);
}

async function main() {
  if (!ACCESS_TOKEN || !SUPABASE_URL) {
    console.error('Erro: SUPABASE_ACCESS_TOKEN e SUPABASE_URL são obrigatórios.');
    process.exit(1);
  }

  fs.mkdirSync(path.join(OUTPUT_DIR, 'functions'), { recursive: true });
  console.log(`Exportando configurações do projeto: ${PROJECT_REF}\n`);

  // 1. Informações gerais do projeto
  console.log('1. Informações do projeto...');
  const project = await apiGet(`/projects/${PROJECT_REF}`);
  await saveJson('project.json', project);

  // 2. Configurações de autenticação (provedores, JWT, email, etc.)
  console.log('2. Configurações de autenticação...');
  const authConfig = await apiGet(`/projects/${PROJECT_REF}/config/auth`);
  await saveJson('auth_config.json', authConfig);

  // 3. Configurações de API (anon key, service role key)
  console.log('3. Configurações de API...');
  try {
    const apiSettings = await apiGet(`/projects/${PROJECT_REF}/api`);
    await saveJson('api_settings.json', apiSettings);
  } catch (e) {
    console.warn(`  Aviso: ${e.message}`);
  }

  // 4. Secrets das Edge Functions (nomes — valores não são expostos pela API por segurança)
  console.log('4. Nomes dos secrets...');
  try {
    const secrets = await apiGet(`/projects/${PROJECT_REF}/secrets`);
    await saveJson('secrets_names.json', secrets);
  } catch (e) {
    console.warn(`  Aviso: ${e.message}`);
  }

  // 5. Edge Functions — lista + código de cada uma
  console.log('5. Edge Functions...');
  const functions = await apiGet(`/projects/${PROJECT_REF}/functions`);
  await saveJson('functions/index.json', functions);

  for (const fn of functions) {
    try {
      const bodyRes = await fetch(
        `${API_BASE}/projects/${PROJECT_REF}/functions/${fn.slug}/body`,
        { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
      );
      if (bodyRes.ok) {
        const buffer = Buffer.from(await bodyRes.arrayBuffer());
        const outPath = path.join(OUTPUT_DIR, 'functions', `${fn.slug}.zip`);
        fs.writeFileSync(outPath, buffer);
        console.log(`  Baixada: ${fn.slug}`);
      } else {
        console.warn(`  Aviso: ${fn.slug} → ${bodyRes.status}`);
      }
    } catch (e) {
      console.warn(`  Erro em ${fn.slug}: ${e.message}`);
    }
  }

  console.log('\nExportação concluída.');
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
