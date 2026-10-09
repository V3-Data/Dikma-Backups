const fs = require('fs');
const path = require('path');

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const OUTPUT_DIR = process.env.OUTPUT_CONFIG_DIR || './config';

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0];
const API_BASE = 'https://api.supabase.com/v1';

let skipped = [];

async function apiGet(endpoint) {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

async function tryGet(label, endpoint, filename) {
  try {
    const data = await apiGet(endpoint);
    fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(data, null, 2));
    console.log(`  OK: ${filename}`);
    return data;
  } catch (e) {
    console.warn(`  IGNORADO (${label}): ${e.message}`);
    skipped.push({ label, endpoint, error: e.message });
    return null;
  }
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
  await tryGet('project info', `/projects/${PROJECT_REF}`, 'project.json');

  // 2. Configurações de autenticação
  console.log('2. Configurações de autenticação...');
  await tryGet('auth config', `/projects/${PROJECT_REF}/config/auth`, 'auth_config.json');

  // 3. API Keys (anon key, service role key) — endpoint correto é /api-keys
  console.log('3. API Keys do projeto...');
  await tryGet('api keys', `/projects/${PROJECT_REF}/api-keys`, 'api_keys.json');

  // 4. Secrets das Edge Functions (apenas nomes)
  console.log('4. Nomes dos secrets...');
  await tryGet('secrets', `/projects/${PROJECT_REF}/secrets`, 'secrets_names.json');

  // 5. Edge Functions
  console.log('5. Edge Functions...');
  const functions = await tryGet('functions list', `/projects/${PROJECT_REF}/functions`, 'functions/index.json');

  if (functions && Array.isArray(functions)) {
    for (const fn of functions) {
      try {
        const bodyRes = await fetch(
          `${API_BASE}/projects/${PROJECT_REF}/functions/${fn.slug}/body`,
          { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
        );
        if (bodyRes.ok) {
          const buffer = Buffer.from(await bodyRes.arrayBuffer());
          fs.writeFileSync(path.join(OUTPUT_DIR, 'functions', `${fn.slug}.zip`), buffer);
          console.log(`  Baixada: ${fn.slug}`);
        } else {
          console.warn(`  IGNORADO (${fn.slug} body): ${bodyRes.status}`);
          skipped.push({ label: `function body: ${fn.slug}`, error: String(bodyRes.status) });
        }
      } catch (e) {
        console.warn(`  IGNORADO (${fn.slug}): ${e.message}`);
        skipped.push({ label: `function body: ${fn.slug}`, error: e.message });
      }
    }
  }

  // Relatório final
  if (skipped.length > 0) {
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'skipped.json'),
      JSON.stringify(skipped, null, 2)
    );
    console.log(`\nAtenção: ${skipped.length} item(s) não exportados (ver config/skipped.json).`);
  } else {
    console.log('\nExportação completa.');
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
