const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const gunzip = promisify(zlib.gunzip);

const BACKUP_DIR = process.argv[2] || '.';
const DB_NAME    = process.argv[3] || null;

// Carrega .env do banco especificado como 2º argumento
if (DB_NAME) {
  const envMap = { crm_vt: '.env', financeiro: '.env.financeiro' };
  const envFile = envMap[DB_NAME];
  if (!envFile) {
    console.error(`Banco desconhecido: "${DB_NAME}". Use "crm_vt" ou "financeiro".`);
    process.exit(1);
  }
  if (!fs.existsSync(envFile)) {
    console.error(`Arquivo ${envFile} não encontrado. Crie-o com as credenciais do banco.`);
    process.exit(1);
  }
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const results = [];

function pass(label, detail = '') {
  results.push({ status: 'PASS', label, detail });
  console.log(`  ✅ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  results.push({ status: 'FAIL', label, detail });
  console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
  results.push({ status: 'WARN', label, detail });
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`);
}

// ─── 1. SQL DUMP ─────────────────────────────────────────────────────────────

async function validateSql() {
  console.log('\n── 1. Banco de dados (banco_completo.sql.gz) ──');
  const sqlPath = path.join(BACKUP_DIR, 'banco_completo.sql.gz');

  if (!fs.existsSync(sqlPath)) {
    fail('Arquivo encontrado', 'banco_completo.sql.gz não existe');
    return;
  }

  const sizeBytes = fs.statSync(sqlPath).size;
  if (sizeBytes === 0) {
    fail('Tamanho do arquivo', 'arquivo vazio');
    return;
  }
  pass('Arquivo encontrado', `${(sizeBytes / 1024 / 1024).toFixed(2)} MB compactado`);

  let sql;
  try {
    const compressed = fs.readFileSync(sqlPath);
    sql = (await gunzip(compressed)).toString('utf8');
    pass('Integridade gzip', 'descompactado com sucesso');
  } catch (e) {
    fail('Integridade gzip', e.message);
    return;
  }

  const tables = (sql.match(/^CREATE TABLE /gm) || []).length;
  const tableNames = [...sql.matchAll(/^CREATE TABLE (?:IF NOT EXISTS )?["`]?(\S+?)["`]?\s*\(/gm)]
    .map(m => m[1]);

  tables > 0
    ? pass('Tabelas encontradas', `${tables} tabelas: ${tableNames.slice(0, 8).join(', ')}${tables > 8 ? '...' : ''}`)
    : fail('Tabelas encontradas', 'nenhuma instrução CREATE TABLE');

  const copyCount = (sql.match(/^COPY .+ FROM stdin/gm) || []).length;
  copyCount > 0
    ? pass('Dados presentes', `${copyCount} bloco(s) COPY encontrado(s)`)
    : warn('Dados presentes', 'nenhum COPY — banco pode estar vazio');

  const hasPolicies = /^CREATE POLICY /m.test(sql);
  hasPolicies
    ? pass('RLS policies', 'encontradas no dump')
    : warn('RLS policies', 'nenhuma encontrada — verifique se existem');

  return tableNames;
}

// ─── 2. STORAGE ──────────────────────────────────────────────────────────────

function countFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFilesRecursive(path.join(dir, entry.name));
    else count++;
  }
  return count;
}

async function listLive(supabase, bucket, folder = '') {
  const all = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, { limit: 100, offset });
    if (error || !data || data.length === 0) break;
    for (const item of data) {
      const p = folder ? `${folder}/${item.name}` : item.name;
      if (!item.id) all.push(...await listLive(supabase, bucket, p));
      else all.push(p);
    }
    if (data.length < 100) break;
    offset += 100;
  }
  return all;
}

async function validateStorage(supabase) {
  console.log('\n── 2. Storage (arquivos dos buckets) ──');
  const storageDir = path.join(BACKUP_DIR, 'storage');

  if (!fs.existsSync(storageDir)) {
    fail('Diretório storage', 'não encontrado no backup');
    return;
  }

  const localBuckets = fs.readdirSync(storageDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);

  if (localBuckets.length === 0) {
    fail('Buckets no backup', 'nenhum bucket encontrado');
    return;
  }

  pass('Buckets no backup', localBuckets.join(', '));

  if (!supabase) {
    warn('Comparação com live', 'credenciais não fornecidas — pulando');
    return;
  }

  const { data: liveBuckets } = await supabase.storage.listBuckets();
  const liveBucketNames = (liveBuckets || []).map(b => b.name);

  for (const bucket of liveBucketNames) {
    const localCount = countFilesRecursive(path.join(storageDir, bucket));
    const liveFiles = await listLive(supabase, bucket);
    const liveCount = liveFiles.length;

    if (!localBuckets.includes(bucket)) {
      fail(`Bucket "${bucket}"`, `presente no projeto mas ausente no backup`);
    } else if (localCount === liveCount) {
      pass(`Bucket "${bucket}"`, `${localCount} arquivo(s) — backup completo`);
    } else {
      warn(`Bucket "${bucket}"`, `backup: ${localCount} arquivo(s), live: ${liveCount} arquivo(s)`);
    }
  }
}

// ─── 3. CONFIG ───────────────────────────────────────────────────────────────

function validateConfig() {
  console.log('\n── 3. Configurações (config/) ──');
  const configDir = path.join(BACKUP_DIR, 'config');

  if (!fs.existsSync(configDir)) {
    fail('Diretório config', 'não encontrado no backup');
    return;
  }

  // project.json
  const projectPath = path.join(configDir, 'project.json');
  if (fs.existsSync(projectPath)) {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    pass('project.json', `projeto: ${project.name} (${project.ref}) — região: ${project.region}`);
  } else {
    fail('project.json', 'não encontrado');
  }

  // auth_config.json
  const authPath = path.join(configDir, 'auth_config.json');
  if (fs.existsSync(authPath)) {
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    const providers = Object.entries(auth)
      .filter(([k, v]) => k.endsWith('_enabled') && v === true)
      .map(([k]) => k.replace('_enabled', ''));
    pass('auth_config.json', `${Object.keys(auth).length} configurações — providers ativos: ${providers.join(', ') || 'nenhum'}`);
  } else {
    fail('auth_config.json', 'não encontrado');
  }

  // api_keys.json
  const keysPath = path.join(configDir, 'api_keys.json');
  if (fs.existsSync(keysPath)) {
    const keys = JSON.parse(fs.readFileSync(keysPath, 'utf8'));
    const names = (Array.isArray(keys) ? keys : [keys]).map(k => k.name).join(', ');
    pass('api_keys.json', `chaves: ${names}`);
  } else {
    fail('api_keys.json', 'não encontrado');
  }

  // secrets_names.json
  const secretsPath = path.join(configDir, 'secrets_names.json');
  if (fs.existsSync(secretsPath)) {
    const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
    pass('secrets_names.json', `${secrets.length} secret(s) registrado(s)`);
  } else {
    warn('secrets_names.json', 'não encontrado — projeto pode não ter secrets de Edge Functions');
  }

  // functions/
  const functionsDir = path.join(configDir, 'functions');
  if (fs.existsSync(functionsDir)) {
    const fns = fs.readdirSync(functionsDir).filter(f => f.endsWith('.zip'));
    fns.length > 0
      ? pass('Edge Functions', `${fns.length} função(ões): ${fns.join(', ')}`)
      : warn('Edge Functions', 'nenhum arquivo .zip — projeto pode não ter Edge Functions');
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const bancoLabel = DB_NAME ? ` [${DB_NAME}]` : '';
  console.log(`\n📦 Validando backup em: ${path.resolve(BACKUP_DIR)}${bancoLabel}`);

  const supabase = (SUPABASE_URL && SUPABASE_SERVICE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { realtime: { transport: ws } })
    : null;

  if (!supabase) {
    console.log('\nℹ️  SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY não definidos — validação offline apenas.\n');
  }

  await validateSql();
  await validateStorage(supabase);
  validateConfig();

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Resultado: ${passed} PASS  ${warned} WARN  ${failed} FAIL`);
  if (failed > 0) {
    console.log('Backup com problemas — verifique os itens marcados com ❌');
    process.exit(1);
  } else if (warned > 0) {
    console.log('Backup válido com avisos — verifique os itens marcados com ⚠️');
  } else {
    console.log('Backup íntegro e completo. ✅');
  }
}

main().catch(err => {
  console.error('\nErro fatal:', err.message);
  process.exit(1);
});
