# Backup Supabase → VM do Cliente via SSH/OpenVPN

Sistema de backup automático diário de projetos Supabase para uma VM Linux do cliente via GitHub Actions. A conexão é feita por OpenVPN e o arquivo é transferido via SCP/SSH.

> **SharePoint:** o script `upload_sharepoint.js` está mantido no repositório para uso manual pontual, mas não é chamado pelo cron.

---

## Bancos cobertos

| Banco | Projeto Supabase | Pasta na VM |
|---|---|---|
| CRM e Visita Técnica | `yasoymnbwibkxkitrsqs` | `/home/backups/CRM_VT/` |
| Financeiro | `rjkabqmtzbucbwayrkao` | `/home/backups/Financeiro/` |

---

## Arquitetura

```
GitHub Actions (cron diário — 03:00 BRT)
│
├── Job: Backup — CRM e Visita Técnica
│   ├── pg_dump → banco_completo.sql.gz
│   ├── download_storage.js → storage/
│   ├── backup_config.js → config/
│   ├── tar → backup-YYYY-MM-DD.tar.gz
│   ├── Conectar OpenVPN (certificado + usuário/senha)
│   ├── scp → VM:/home/backups/CRM_VT/YYYY-MM-DD/backup-YYYY-MM-DD.tar.gz
│   └── Desconectar OpenVPN
│
└── Job: Backup — Financeiro  (inicia após CRM_VT, mesmo se falhar)
    ├── pg_dump → banco_completo.sql.gz
    ├── download_storage.js → storage/
    ├── backup_config.js → config/
    ├── tar → backup-YYYY-MM-DD.tar.gz
    ├── Conectar OpenVPN (certificado + usuário/senha)
    ├── scp → VM:/home/backups/Financeiro/YYYY-MM-DD/backup-YYYY-MM-DD.tar.gz
    └── Desconectar OpenVPN
```

Cada backup gera um arquivo `backup-YYYY-MM-DD.tar.gz` contendo:
- `banco_completo.sql.gz` — dump completo do PostgreSQL
- `storage/` — todos os arquivos dos buckets do Supabase Storage
- `config/` — configurações de auth, API keys, Edge Functions

---

## Cron

| Campo | Valor | Significado |
|---|---|---|
| Expressão | `0 6 * * *` | Todo dia às 06:00 UTC |
| Horário Brasil | 03:00 | Horário de Brasília (UTC-3) |

Para disparar manualmente:

```bash
gh workflow run "Backup Supabase para VM do Cliente"

# Ou: GitHub → Actions → Backup Supabase para VM do Cliente → Run workflow
```

---

## Configuração inicial

### Pré-requisitos

- [GitHub CLI](https://cli.github.com/) instalado e autenticado (`gh auth login`)
- Node.js 22+
- PostgreSQL client 17 (apenas para restore local)
- Acesso SSH à VM do cliente e conexão OpenVPN configurada

### 1. Gerar par de chaves SSH

Execute no PowerShell (não no Git Bash — evita conversão de paths):

```powershell
ssh-keygen -t ed25519 -C "github-actions-backup" -f "$env:USERPROFILE\Desktop\github-actions-backup-key"
```

Dois arquivos são gerados:
- `github-actions-backup-key` → chave privada (vai para o GitHub Secret)
- `github-actions-backup-key.pub` → chave pública (vai para o servidor)

**No servidor Linux**, adicione a chave pública:

```bash
cat github-actions-backup-key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Crie a estrutura de pastas na VM** (se ainda não existir):

```bash
sudo mkdir -p /home/backups/CRM_VT
sudo mkdir -p /home/backups/Financeiro
sudo chown -R $USER:$USER /home/backups
```

### 2. Configurar Secrets do GitHub Actions

> **Atenção:** Secrets com caminhos Linux (ex: `/home/backups/CRM_VT`) devem ser configurados pela **interface web do GitHub** (Settings → Secrets → Actions) ou via `gh secret set --body "valor"` executado no **PowerShell** (não no Git Bash). O Git Bash converte automaticamente paths Unix para `C:/Program Files/Git/...`, corrompendo o valor.

**Supabase — CRM e Visita Técnica:**

```bash
gh secret set CRM_VT_SUPABASE_DB_URL \
  --body "postgresql://postgres.yasoymnbwibkxkitrsqs:SENHA@aws-1-us-east-1.pooler.supabase.com:6543/postgres"
gh secret set CRM_VT_SUPABASE_URL          --body "https://yasoymnbwibkxkitrsqs.supabase.co"
gh secret set CRM_VT_SUPABASE_SERVICE_ROLE_KEY --body "eyJ..."
gh secret set CRM_VT_SUPABASE_ACCESS_TOKEN --body "sbp_..."
```

**Supabase — Financeiro:**

```bash
gh secret set FINANCEIRO_SUPABASE_DB_URL \
  --body "postgresql://postgres.rjkabqmtzbucbwayrkao:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
gh secret set FINANCEIRO_SUPABASE_URL          --body "https://rjkabqmtzbucbwayrkao.supabase.co"
gh secret set FINANCEIRO_SUPABASE_SERVICE_ROLE_KEY --body "eyJ..."
gh secret set FINANCEIRO_SUPABASE_ACCESS_TOKEN --body "sbp_..."
```

**OpenVPN:**

```bash
# Conteúdo completo do arquivo .ovpn
gh secret set OPENVPN_CONFIG   < "caminho\para\arquivo.ovpn"
gh secret set OPENVPN_USERNAME --body "usuario_vpn"
gh secret set OPENVPN_PASSWORD --body "senha_vpn"
```

**SSH — via interface web ou PowerShell:**

| Secret | Valor |
|---|---|
| `SSH_HOST` | IP ou hostname da VM |
| `SSH_PORT` | Porta SSH (ex: `22`) |
| `SSH_USER` | Usuário SSH na VM |
| `SSH_PRIVATE_KEY` | Conteúdo do arquivo `github-actions-backup-key` |
| `CRM_VT_SSH_PATH` | `/home/backups/CRM_VT` |
| `FINANCEIRO_SSH_PATH` | `/home/backups/Financeiro` |

Para `SSH_PRIVATE_KEY`, use o GitHub CLI lendo direto do arquivo:

```powershell
gh secret set SSH_PRIVATE_KEY < "$env:USERPROFILE\Desktop\github-actions-backup-key"
```

**SharePoint (mantidos para uso manual):**

```bash
gh secret set SHAREPOINT_TENANT_ID     --body "2f54a0d1-5a1c-406d-a20c-a25686ea3748"
gh secret set SHAREPOINT_CLIENT_ID     --body "7bc40c57-9138-4261-b233-5e9e995087b1"
gh secret set SHAREPOINT_CLIENT_SECRET --body "QH-8Q~..."
gh secret set SHAREPOINT_SITE_URL      --body "https://vortexexecution.sharepoint.com/sites/V3"
gh secret set CRM_VT_SHAREPOINT_PATH   --body "Backups/01. CRM_VT"
gh secret set FINANCEIRO_SHAREPOINT_PATH --body "Backups/02. Financeiro"
```

### Arquivos de ambiente locais

Para uso local (scripts manuais, testes):

| Arquivo | Banco |
|---|---|
| `.env` | CRM e Visita Técnica |
| `.env.financeiro` | Financeiro |

Esses arquivos nunca são commitados (`.gitignore`).

---

## Upload manual para SharePoint

O script `upload_sharepoint.js` está disponível para enviar um backup pontual ao SharePoint sem passar pelo cron:

```bash
# Exemplo para CRM_VT
export SHAREPOINT_TENANT_ID="..."
export SHAREPOINT_CLIENT_ID="..."
export SHAREPOINT_CLIENT_SECRET="..."
export SHAREPOINT_SITE_URL="..."
export SHAREPOINT_REMOTE_FOLDER="Backups/01. CRM_VT"
export TODAY_DATE="2026-10-13"
LOCAL_BACKUP_FILE="backup-2026-10-13.tar.gz" node upload_sharepoint.js
```

---

## Restore

O script lê as credenciais do **banco de destino** a partir de `.env.restore.crm-vt` ou `.env.restore.financeiro` — arquivos locais e gitignored.

### 1. Crie o arquivo de credenciais de destino

```bash
cp .env.restore.crm-vt.example .env.restore.crm-vt
# Edite com as credenciais do banco de destino
```

### 2. Execute o restore

```bash
# Sintaxe
./restore.sh <banco> <arquivo-backup.tar.gz>

# Exemplos
./restore.sh crm_vt     backup-2026-10-13.tar.gz
./restore.sh financeiro backup-2026-10-13.tar.gz
```

O script realiza, nesta ordem:
1. **Extração** — descompacta o `.tar.gz` em diretório temporário
2. **Banco de dados** — psql restaura o dump SQL completo
3. **Storage** — recria buckets e faz upload de todos os arquivos
4. **Edge Functions** — cria ou atualiza via Management API (PUT para existentes, POST para novas)
5. **Validação automática** — roda `validate_backup.js` para confirmar integridade
6. **Limpeza** — remove o diretório temporário (mesmo em caso de erro)

Erros do psql são registrados em `restore-YYYYMMDD-HHMMSS.log` mas não interrompem o restore.

---

## Validação de backup

```bash
./validate.sh crm_vt     backup-2026-10-13.tar.gz
./validate.sh financeiro backup-2026-10-13.tar.gz
```

Se o `.env` / `.env.financeiro` estiver presente, conecta ao banco ao vivo e compara a contagem de arquivos no Storage. Caso contrário, faz apenas validação estrutural (offline).

Saída:
- `PASS` — item presente e válido
- `WARN` — item ausente mas não crítico
- `FAIL` — item crítico ausente (backup comprometido)

Exit code `1` se houver qualquer `FAIL`.

---

## Como adicionar um novo banco

1. **Crie os secrets** no GitHub com o prefixo do novo banco (ex: `NOVO_BANCO_SUPABASE_DB_URL`, etc.) + `NOVO_BANCO_SSH_PATH`
2. **Adicione um novo job** em `.github/workflows/supabase_backup.yml` copiando o bloco do job `backup-financeiro` e ajustando:
   - `name:` do job
   - `needs:` (aponte para o job anterior)
   - Todos os `secrets.PREFIXO_*` para o novo prefixo
3. **Crie a pasta na VM:** `sudo mkdir -p /home/backups/NOVO_BANCO`
4. **Adicione uma linha** na tabela "Bancos cobertos" neste README
5. **Crie os templates** `.env.restore.NOVO.example` para restore local
6. **Adicione ao `.gitignore`**: `.env.novo-banco` e `.env.restore.novo-banco`
