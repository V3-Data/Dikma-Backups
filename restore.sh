#!/bin/bash
set -e

# Carrega credenciais do arquivo .env.restore se existir
if [ -f ".env.restore" ]; then
  export $(grep -v '^#' .env.restore | xargs)
fi

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
  echo "Uso:   ./restore.sh <arquivo-backup.tar.gz>"
  echo "Exemplo: ./restore.sh backup-2026-10-08.tar.gz"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Arquivo não encontrado: $BACKUP_FILE"
  exit 1
fi

if [ -z "$SUPABASE_DB_URL" ] || [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "Erro: as variáveis SUPABASE_DB_URL, SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias."
  echo "Crie um arquivo .env.restore com as credenciais do banco de destino."
  exit 1
fi

RESTORE_DIR=$(mktemp -d)
echo "Extraindo $BACKUP_FILE em: $RESTORE_DIR"
tar -xzf "$BACKUP_FILE" -C "$RESTORE_DIR"

# 1. Restore do banco de dados
echo ""
echo "=== 1. Restaurando banco de dados ==="
gunzip -c "$RESTORE_DIR/banco_completo.sql.gz" | psql "$SUPABASE_DB_URL"
echo "Banco restaurado com sucesso."

# 2. Restore do storage
echo ""
echo "=== 2. Restaurando Storage ==="
SUPABASE_URL="$SUPABASE_URL" \
SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY" \
STORAGE_DIR="$RESTORE_DIR/storage" \
node restore_storage.js

# Limpeza
rm -rf "$RESTORE_DIR"

echo ""
echo "=== Restauração concluída ==="
