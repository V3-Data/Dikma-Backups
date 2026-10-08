const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_STORAGE_DIR = process.env.OUTPUT_STORAGE_DIR || './storage';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
  process.exit(1);
}

console.log(`Conectando ao projeto: ${new URL(SUPABASE_URL).hostname}`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});

async function listAll(bucketName, folder) {
  const allItems = [];
  const PAGE_SIZE = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucketName).list(folder, {
      limit: PAGE_SIZE,
      offset,
    });

    if (error) {
      console.error(`Erro ao listar ${bucketName}/${folder}:`, error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allItems.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return allItems;
}

async function downloadFolder(bucketName, remoteFolder) {
  const items = await listAll(bucketName, remoteFolder);

  for (const item of items) {
    const remoteFilePath = remoteFolder ? `${remoteFolder}/${item.name}` : item.name;
    const localFilePath = path.join(OUTPUT_STORAGE_DIR, bucketName, remoteFilePath);

    if (!item.id) {
      // É uma pasta — recursão
      await downloadFolder(bucketName, remoteFilePath);
    } else {
      if (fs.existsSync(localFilePath)) {
        const stats = fs.statSync(localFilePath);
        if (stats.size === item.metadata?.size) {
          console.log(`  Ignorado (já existe): ${remoteFilePath}`);
          continue;
        }
      }

      console.log(`  Baixando: ${bucketName}/${remoteFilePath}`);
      const { data, error: downloadError } = await supabase.storage
        .from(bucketName)
        .download(remoteFilePath);

      if (downloadError) {
        console.error(`  Erro ao baixar ${remoteFilePath}:`, downloadError.message);
        continue;
      }

      fs.mkdirSync(path.dirname(localFilePath), { recursive: true });
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(localFilePath, buffer);
    }
  }
}

async function startBackup() {
  const { data: buckets, error } = await supabase.storage.listBuckets();

  if (error) {
    console.error('Erro ao listar buckets:', error.message);
    process.exit(1);
  }

  if (!buckets || buckets.length === 0) {
    console.warn('Nenhum bucket encontrado. Verifique se SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY estão corretos e apontam para o mesmo projeto.');
    process.exit(0);
  }

  console.log(`\nBuckets encontrados (${buckets.length}): ${buckets.map(b => b.name).join(', ')}\n`);

  for (const bucket of buckets) {
    console.log(`Sincronizando bucket: ${bucket.name}`);
    await downloadFolder(bucket.name, '');
    console.log(`Bucket concluído: ${bucket.name}\n`);
  }

  console.log('Sincronização do Storage concluída.');
}

startBackup();
