#!/bin/bash
set -e

# Uso:
#   ./validate.sh crm_vt     <arquivo-backup.tar.gz>
#   ./validate.sh financeiro <arquivo-backup.tar.gz>
#
# Extrai o backup em diretório temporário, valida a integridade e limpa.
# Com credenciais (.env ou .env.financeiro), compara também com o banco ao vivo.

DB_NAME="${1:-}"
BACKUP_FILE="${2:-}"

if [ -z "$DB_NAME" ] || [ -z "$BACKUP_FILE" ]; then
  echo "Uso:   ./validate.sh <banco> <arquivo-backup.tar.gz>"
  echo ""
  echo "Bancos disponíveis:"
  echo "  crm_vt      → carrega .env para comparação ao vivo"
  echo "  financeiro  → carrega .env.financeiro para comparação ao vivo"
  echo ""
  echo "Exemplos:"
  echo "  ./validate.sh crm_vt     backup-2026-10-09.tar.gz"
  echo "  ./validate.sh financeiro backup-2026-10-09.tar.gz"
  exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "Arquivo não encontrado: $BACKUP_FILE"
  exit 1
fi

# Carrega credenciais do banco para comparação ao vivo (opcional)
case "$DB_NAME" in
  crm_vt)
    ENV_FILE=".env"
    ;;
  financeiro)
    ENV_FILE=".env.financeiro"
    ;;
  *)
    echo "Banco desconhecido: '$DB_NAME'. Use 'crm_vt' ou 'financeiro'."
    exit 1
    ;;
esac

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
else
  echo "Aviso: $ENV_FILE não encontrado — validação offline (sem comparação ao vivo)."
fi

VALIDATE_DIR="./validate_tmp_$$"
mkdir -p "$VALIDATE_DIR"
trap 'rm -rf "$VALIDATE_DIR"' EXIT

echo "Extraindo $BACKUP_FILE em: $VALIDATE_DIR"
tar -xzf "$BACKUP_FILE" -C "$VALIDATE_DIR"

echo ""
node validate_backup.js "$VALIDATE_DIR"
