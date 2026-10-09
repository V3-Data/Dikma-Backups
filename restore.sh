#!/bin/bash
set -e

# Uso:
#   ./restore.sh crm_vt     <arquivo-backup.tar.gz>
#   ./restore.sh financeiro <arquivo-backup.tar.gz>

DB_NAME="${1:-}"
BACKUP_FILE="${2:-}"

if [ -z "$DB_NAME" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Uso:   ./restore.sh <banco> <arquivo-backup.tar.gz>"
  echo ""
  echo "Bancos disponíveis:"
  echo "  crm_vt      → carrega .env.restore.crm-vt"
  echo "  financeiro  → carrega .env.restore.financeiro"
  echo ""
  echo "Exemplos:"
  echo "  ./restore.sh crm_vt     backup-2026-10-09.tar.gz"
  echo "  ./restore.sh financeiro backup-2026-10-09.tar.gz"
  exit 1
fi

# Seleciona o arquivo de credenciais de acordo com o banco
case "$DB_NAME" in
  crm_vt)
    ENV_FILE=".env.restore.crm-vt"
    ;;
  financeiro)
    ENV_FILE=".env.restore.financeiro"
    ;;
  *)
    echo "Banco desconhecido: '$DB_NAME'. Use 'crm_vt' ou 'financeiro'."
    exit 1
    ;;
esac

# Carrega credenciais — env file específico ou fallback para .env.restore
if [ -f "$ENV_FILE" ]; then
  echo "Carregando credenciais de: $ENV_FILE"
  export $(grep -v '^#' "$ENV_FILE" | xargs)
elif [ -f ".env.restore" ]; then
  echo "Arquivo $ENV_FILE não encontrado, usando .env.restore como fallback."
  export $(grep -v '^#' .env.restore | xargs)
else
  echo "Nenhum arquivo de credenciais encontrado."
  echo "Crie $ENV_FILE com as credenciais do banco de destino."
  echo "(Veja $ENV_FILE.example como referência)"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Arquivo não encontrado: $BACKUP_FILE"
  exit 1
fi

if [ -z "$SUPABASE_DB_URL" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Erro: SUPABASE_DB_URL, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios."
  exit 1
fi

PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://||' | cut -d'.' -f1)

# Diretório de extração relativo ao projeto — evita problemas de conversão de
# caminho entre Git Bash e Node.js no Windows (/tmp vs C:\tmp)
RESTORE_DIR="./restore_tmp_$$"
mkdir -p "$RESTORE_DIR"
trap 'rm -rf "$RESTORE_DIR"' EXIT

echo "Extraindo $BACKUP_FILE em: $RESTORE_DIR"
tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR"

# 1. Restore do banco de dados
echo ""
echo "=== 1. Restaurando banco de dados ($DB_NAME) ==="
PSQL_LOG="restore-$(date +%Y%m%d-%H%M%S).log"
gunzip -c "$RESTORE_DIR/banco_completo.sql.gz" | psql "$SUPABASE_DB_URL" 2>"$PSQL_LOG" || true

ERROS=$(grep -c "^ERROR:" "$PSQL_LOG" 2>/dev/null || echo 0)
if [ "$ERROS" -gt 0 ]; then
  echo "Banco restaurado com $ERROS aviso(s) — veja $PSQL_LOG para detalhes."
else
  echo "Banco restaurado com sucesso."
fi

# 2. Restore do storage
echo ""
echo "=== 2. Restaurando Storage ==="
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
STORAGE_DIR="$RESTORE_DIR/storage" \
node restore_storage.js

# 3. Deploy das Edge Functions via Management API
echo ""
echo "=== 3. Implantando Edge Functions ==="
FUNCTIONS_DIR="$RESTORE_DIR/config/functions"
INDEX_JSON="$FUNCTIONS_DIR/index.json"

if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "SUPABASE_ACCESS_TOKEN não definido — Edge Functions ignoradas."
elif [ ! -d "$FUNCTIONS_DIR" ] || [ ! -f "$INDEX_JSON" ]; then
  echo "index.json não encontrado no backup — projeto sem Edge Functions, ignorando."
else
  # Passa o path como argumento de CLI (MSYS2 converte corretamente no Windows)
  SLUGS=$(node -e "
    const fns = JSON.parse(require('fs').readFileSync(process.argv[1]));
    fns.forEach(f => console.log(f.slug));
  " "$INDEX_JSON")

  for SLUG in $SLUGS; do
    ZIP_FILE="$FUNCTIONS_DIR/${SLUG}.zip"
    if [ ! -f "$ZIP_FILE" ]; then
      echo "  ZIP não encontrado para $SLUG — ignorando."
      continue
    fi

    echo "  Implantando: $SLUG"

    # Tenta atualizar (PUT). Se 404, a função não existe no projeto destino — cria primeiro (POST)
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X PUT "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$SLUG/body" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
      -H "Content-Type: application/zip" \
      --data-binary "@$ZIP_FILE")

    if [ "$HTTP_STATUS" = "404" ]; then
      echo "  Função não existe — criando: $SLUG"
      curl -s -o /dev/null \
        -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/functions" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"slug\": \"$SLUG\", \"name\": \"$SLUG\", \"verify_jwt\": true}"

      HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -X PUT "https://api.supabase.com/v1/projects/$PROJECT_REF/functions/$SLUG/body" \
        -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
        -H "Content-Type: application/zip" \
        --data-binary "@$ZIP_FILE")
    fi

    if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "201" ] || [ "$HTTP_STATUS" = "202" ]; then
      echo "  OK: $SLUG (HTTP $HTTP_STATUS)"
    else
      echo "  Erro: $SLUG retornou HTTP $HTTP_STATUS"
    fi
  done
fi

# 4. Validação do backup restaurado
echo ""
echo "=== 4. Validando backup restaurado ==="
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
node validate_backup.js "$RESTORE_DIR" || true

echo ""
echo "=== Restauração concluída ($DB_NAME) ==="
