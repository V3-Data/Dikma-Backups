# Backup Supabase → SharePoint

Sistema de backup automático diário de projetos Supabase para o SharePoint via GitHub Actions.

---

## Bancos cobertos

| Banco | Projeto Supabase | Pasta no SharePoint |
|---|---|---|
| CRM e Visita Técnica | `yasoymnbwibkxkitrsqs` | `Backups/01. CRM_VT/` |
| Financeiro | `rjkabqmtzbucbwayrkao` | `Backups/02. Financeiro/` |

---

## Arquitetura

```
GitHub Actions (cron diário)
│
├── Job: Backup — CRM e Visita Técnica
│   ├── pg_dump → banco_completo.sql.gz
│   ├── download_storage.js → storage/
│   ├── backup_config.js → config/
│   └── tar + upload_sharepoint.js → SharePoint/01. CRM_VT/YYYY-MM-DD/
│
└── Job: Backup — Financeiro  (inicia após CRM_VT, mesmo se falhar)
    ├── pg_dump → banco_completo.sql.gz
    ├── download_storage.js → storage/
    ├── backup_config.js → config/
    └── tar + upload_sharepoint.js → SharePoint/02. Financeiro/YYYY-MM-DD/
```

Cada backup gera um arquivo `backup-YYYY-MM-DD.tar.gz` contendo:
- `banco_completo.sql.gz` — dump completo do PostgreSQL
- `storage/` — todos os arquivos dos buckets do Supabase Storage
- `config/` — configurações de auth, API keys, Edge Functions

---

## Cron

| Campo | Valor | Significado |
|---|---|---|
| Expressão | `0 3 * * *` | Todo dia às 03:00 UTC |
| Horário Brasil | 00:00 (meia-noite) | Horário de Brasília (UTC-3) |

O workflow roda automaticamente a cada 24h. Para disparar manualmente:

```bash
# Via GitHub CLI
gh workflow run "Backup Supabase para SharePoint"

# Ou acesse: GitHub → Actions → Backup Supabase para SharePoint → Run workflow
```

---

## Configuração inicial

### Pré-requisitos

- [GitHub CLI](https://cli.github.com/) instalado e autenticado (`gh auth login`)
- Node.js 22+
- PostgreSQL client 17 (apenas para restore local)

### Secrets do GitHub Actions

Configure todos os secrets abaixo no repositório. Os secrets do SharePoint são compartilhados; os do Supabase são individuais por banco.

```bash
# ── CRM e Visita Técnica ──────────────────────────────────────────────
gh secret set CRM_VT_SUPABASE_DB_URL \
  --body "postgresql://postgres.yasoymnbwibkxkitrsqs:SENHA@aws-1-us-east-1.pooler.supabase.com:6543/postgres"

gh secret set CRM_VT_SUPABASE_URL \
  --body "https://yasoymnbwibkxkitrsqs.supabase.co"

gh secret set CRM_VT_SUPABASE_SERVICE_ROLE_KEY \
  --body "eyJ..."

gh secret set CRM_VT_SUPABASE_ACCESS_TOKEN \
  --body "sbp_..."

gh secret set CRM_VT_SHAREPOINT_PATH \
  --body "Projetos/1. CLIENTES/1. V3 DATA/01. ATIVOS/DIKMA/Backups/01. CRM_VT"

# ── Financeiro ────────────────────────────────────────────────────────
gh secret set FINANCEIRO_SUPABASE_DB_URL \
  --body "postgresql://postgres.rjkabqmtzbucbwayrkao:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"

gh secret set FINANCEIRO_SUPABASE_URL \
  --body "https://rjkabqmtzbucbwayrkao.supabase.co"

gh secret set FINANCEIRO_SUPABASE_SERVICE_ROLE_KEY \
  --body "eyJ..."

gh secret set FINANCEIRO_SUPABASE_ACCESS_TOKEN \
  --body "sbp_..."

gh secret set FINANCEIRO_SHAREPOINT_PATH \
  --body "Projetos/1. CLIENTES/1. V3 DATA/01. ATIVOS/DIKMA/Backups/02. Financeiro"

# ── SharePoint (compartilhado) ────────────────────────────────────────
gh secret set SHAREPOINT_TENANT_ID    --body "2f54a0d1-5a1c-406d-a20c-a25686ea3748"
gh secret set SHAREPOINT_CLIENT_ID    --body "7bc40c57-9138-4261-b233-5e9e995087b1"
gh secret set SHAREPOINT_CLIENT_SECRET --body "QH-8Q~..."
gh secret set SHAREPOINT_SITE_URL     --body "https://vortexexecution.sharepoint.com/sites/V3"
```

### Arquivos de ambiente locais

Para uso local (scripts manuais, testes):

| Arquivo | Banco |
|---|---|
| `.env` | CRM e Visita Técnica |
| `.env.financeiro` | Financeiro |

Esses arquivos nunca são commitados (`.gitignore`).

---

## Restore

O script lê as credenciais do **banco de destino** a partir de `.env.restore.crm-vt` ou `.env.restore.financeiro` — arquivos locais e gitignored. Basta apontar esses arquivos para o banco desejado (produção, staging ou um projeto em branco para teste).

### Testando o restore em um banco zerado (recomendado antes de usar em produção)

1. Crie um projeto Supabase novo (plano gratuito serve) exclusivo para testes
2. Copie o template e preencha com as credenciais desse projeto de teste:

```bash
cp .env.restore.crm-vt.example .env.restore.crm-vt
```

```env
SUPABASE_DB_URL=postgresql://postgres.SEU_PROJETO_TESTE:SENHA@aws-...pooler.supabase.com:6543/postgres
SUPABASE_URL=https://SEU_PROJETO_TESTE.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ACCESS_TOKEN=sbp_...  # opcional, só para testar reimplantação de Edge Functions
```

3. Execute o restore e valide o resultado:

```bash
./restore.sh crm_vt backup-2026-10-09.tar.gz
node validate_backup.js ./backups/2026-10-09 crm_vt
```

Para apontar o restore para produção, basta trocar as credenciais no `.env.restore.crm-vt` — o script não muda.

### Restore em produção

### 1. Crie o arquivo de credenciais de destino

```bash
# Para CRM e Visita Técnica
cp .env.restore.crm-vt.example .env.restore.crm-vt
# Edite .env.restore.crm-vt com as credenciais do banco de destino

# Para Financeiro
cp .env.restore.financeiro.example .env.restore.financeiro
# Edite .env.restore.financeiro com as credenciais do banco de destino
```

### 2. Execute o restore

```bash
# Sintaxe
./restore.sh <banco> <arquivo-backup.tar.gz>

# Exemplos
./restore.sh crm_vt     backup-2026-10-09.tar.gz
./restore.sh financeiro backup-2026-10-09.tar.gz
```

O script realiza, nesta ordem:
1. **Extração** — descompacta o `.tar.gz` em diretório temporário
2. **Banco de dados** — psql restaura o dump SQL completo
3. **Storage** — recria buckets e faz upload de todos os arquivos
4. **Edge Functions** — reimplanta via Management API (requer `SUPABASE_ACCESS_TOKEN`)
5. **Validação automática** — roda `validate_backup.js` no diretório extraído para confirmar a integridade do que foi restaurado
6. **Limpeza** — remove o diretório temporário (mesmo em caso de erro)

Erros do psql são registrados em `restore-YYYYMMDD-HHMMSS.log` mas não interrompem o restore. Esse arquivo é ignorado pelo git.

---

## Validação de backup

Use `validate.sh` para verificar a integridade de um backup (`.tar.gz`) diretamente — ele extrai em diretório temporário, valida e limpa:

```bash
./validate.sh crm_vt     backup-2026-10-09.tar.gz
./validate.sh financeiro backup-2026-10-09.tar.gz
```

Se o `.env` / `.env.financeiro` estiver presente, o script conecta ao banco ao vivo e compara a contagem de arquivos no Storage. Caso contrário, faz apenas validação estrutural (offline).

> O restore já roda a validação automaticamente no final — o `validate.sh` é para checar um backup sem precisar restaurá-lo.

Saída:
- `PASS` — item presente e válido
- `WARN` — item ausente mas não crítico
- `FAIL` — item crítico ausente (backup comprometido)

Exit code `1` se houver qualquer `FAIL`.

---

## Como adicionar um novo banco

1. **Crie os secrets** no GitHub com o prefixo do novo banco (ex: `NOVO_BANCO_SUPABASE_DB_URL`, etc.)
2. **Adicione um novo job** em `.github/workflows/supabase_backup.yml` copiando o bloco do job `backup-financeiro` e ajustando:
   - `name:` do job
   - `needs:` (aponte para o job anterior)
   - Todos os `secrets.PREFIXO_*` para o novo prefixo
3. **Adicione uma linha** na tabela "Bancos cobertos" neste README
4. **Crie os templates** `.env.restore.NOVO.example` para restore local
5. **Adicione ao `.gitignore`**: `.env.novo-banco` e `.env.restore.novo-banco`
