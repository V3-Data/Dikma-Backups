const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_DIR = process.env.STORAGE_DIR || './storage';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  process.exit(1);
}

console.log(`Conectando ao projeto: ${new URL(SUPABASE_URL).hostname}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});

async function ensureBucket(bucketName) {
  const { data, error } = await supabase.storage.getBucket(bucketName);
  if (!data) {
    const { error: createError } = await supabase.storage.createBucket(bucketName, { public: false });
    if (createError) throw new Error(`Falha ao criar bucket "${bucketName}": ${createError.message}`);
    console.log(`  Bucket criado: ${bucketName}`);
  }
}

async function uploadFolder(bucketName, localDir, remotePrefix = '') {
  const entries = fs.readdirSync(localDir, { withFileTypes: true });

  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = remotePrefix ? `${remotePrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      await uploadFolder(bucketName, localPath, remotePath);
    } else {
      const fileBuffer = fs.readFileSync(localPath);
      console.log(`  Enviando: ${bucketName}/${remotePath}`);

      const { error } = await supabase.storage
        .from(bucketName)
        .upload(remotePath, fileBuffer, { upsert: true });

      if (error) {
        console.error(`  Erro ao enviar ${remotePath}:`, error.message);
      }
    }
  }
}

async function main() {
  if (!fs.existsSync(STORAGE_DIR)) {
    console.error(`Diretório de storage não encontrado: ${STORAGE_DIR}`);
    process.exit(1);
  }

  const buckets = fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  if (buckets.length === 0) {
    console.warn('Nenhum bucket encontrado no diretório de storage.');
    return;
  }

  console.log(`\nBuckets a restaurar (${buckets.length}): ${buckets.join(', ')}\n`);

  for (const bucket of buckets) {
    console.log(`Restaurando bucket: ${bucket}`);
    await ensureBucket(bucket);
    await uploadFolder(bucket, path.join(STORAGE_DIR, bucket));
    console.log(`Bucket concluído: ${bucket}\n`);
  }

  console.log('Restauração do Storage concluída.');
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
