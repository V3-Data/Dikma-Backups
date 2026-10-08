const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OUTPUT_STORAGE_DIR = process.env.OUTPUT_STORAGE_DIR || './storage';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Erro: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  realtime: { transport: ws },
});

async function downloadFolder(bucketName, remoteFolder = '') {
  const { data: files, error } = await supabase.storage.from(bucketName).list(remoteFolder, {
    limit: 1000,
    offset: 0,
  });

  if (error) {
    console.error(`Erro ao listar ${bucketName}/${remoteFolder}:`, error.message);
    return;
  }

  for (const item of files) {
    const remoteFilePath = remoteFolder ? `${remoteFolder}/${item.name}` : item.name;
    const localFilePath = path.join(OUTPUT_STORAGE_DIR, bucketName, remoteFilePath);

    if (!item.id) {
      await downloadFolder(bucketName, remoteFilePath);
    } else {
      if (fs.existsSync(localFilePath)) {
        const stats = fs.statSync(localFilePath);
        if (stats.size === item.metadata?.size) {
          continue;
        }
      }

      console.log(`Baixando: ${bucketName}/${remoteFilePath}`);
      const { data, error: downloadError } = await supabase.storage.from(bucketName).download(remoteFilePath);

      if (downloadError) {
        console.error(`Erro ao baixar ${remoteFilePath}:`, downloadError.message);
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
    console.error("Erro ao listar buckets:", error.message);
    process.exit(1);
  }

  for (const bucket of buckets) {
    console.log(`Sincronizando bucket: ${bucket.name}`);
    await downloadFolder(bucket.name, '');
  }

  console.log("Sincronização de arquivos do Storage concluída!");
}

startBackup();