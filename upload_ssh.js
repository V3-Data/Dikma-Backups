const SftpClient = require('ssh2-sftp-client');
const fs = require('fs');

const {
  SSH_HOST,
  SSH_PORT = '22',
  SSH_USER,
  SSH_PRIVATE_KEY,
  SSH_REMOTE_PATH,
  LOCAL_BACKUP_FILE,
  TODAY_DATE,
} = process.env;

const required = { SSH_HOST, SSH_USER, SSH_PRIVATE_KEY, SSH_REMOTE_PATH, LOCAL_BACKUP_FILE, TODAY_DATE };
const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Variáveis de ambiente ausentes: ${missing.join(', ')}`);
  process.exit(1);
}

if (!fs.existsSync(LOCAL_BACKUP_FILE)) {
  console.error(`Arquivo não encontrado: ${LOCAL_BACKUP_FILE}`);
  process.exit(1);
}

const remoteDir = `${SSH_REMOTE_PATH}/${TODAY_DATE}`;
const remoteFile = `${remoteDir}/backup-${TODAY_DATE}.tar.gz`;
const fileSize = (fs.statSync(LOCAL_BACKUP_FILE).size / (1024 * 1024)).toFixed(2);

const sftp = new SftpClient();

async function upload() {
  console.log(`Conectando ao servidor SSH: ${SSH_USER}@${SSH_HOST}:${SSH_PORT}`);

  await sftp.connect({
    host: SSH_HOST,
    port: parseInt(SSH_PORT),
    username: SSH_USER,
    privateKey: SSH_PRIVATE_KEY,
    keepaliveInterval: 10000,
    keepaliveCountMax: 10,
    readyTimeout: 30000,
  });

  console.log(`Criando diretório remoto: ${remoteDir}`);
  await sftp.mkdir(remoteDir, true);

  console.log(`Enviando ${LOCAL_BACKUP_FILE} (${fileSize} MB) → ${remoteFile}`);

  let lastPct = -1;
  await sftp.put(LOCAL_BACKUP_FILE, remoteFile, {
    step: (transferred, _chunk, total) => {
      const pct = Math.floor((transferred / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        const mb = (transferred / 1024 / 1024).toFixed(1);
        const totalMb = (total / 1024 / 1024).toFixed(1);
        console.log(`  ${pct}% — ${mb} MB / ${totalMb} MB`);
        lastPct = pct;
      }
    },
  });

  console.log('Upload concluído com sucesso!');
  await sftp.end();
}

upload().catch((err) => {
  console.error('Erro no upload SSH:', err.message);
  sftp.end().catch(() => {});
  process.exit(1);
});
