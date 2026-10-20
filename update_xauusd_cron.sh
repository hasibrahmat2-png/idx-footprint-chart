#!/bin/bash
# ==============================================================================
# Periodic 5-minute runner for XAUUSD update pipeline
# ==============================================================================
set -e

SCRIPT_DIR="/home/hasibrahmat2/lightweight-charts-master"
cd "$SCRIPT_DIR"

# Prevent overlapping runs
PIDFILE="/tmp/update_xauusd.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update already running (PID: $(cat "$PIDFILE")), skipping..."
    exit 0
fi

echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

# Prioritas token:
# 1. Gunakan EXNESS_TOKEN yang sudah di-export di terminal/environment (jika ada)
# 2. Ambil dari file .env
# 3. Fallback token
if [ -z "$EXNESS_TOKEN" ]; then
    if [ -f "$SCRIPT_DIR/.env" ]; then
        ENV_TOKEN=$(grep -E "^EXNESS_TOKEN=" "$SCRIPT_DIR/.env" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
        if [ -n "$ENV_TOKEN" ]; then
            export EXNESS_TOKEN="$ENV_TOKEN"
        fi
    fi
fi

if [ -z "$EXNESS_TOKEN" ]; then
    export EXNESS_TOKEN="Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InVzZXIiLCJ0eXAiOiJKV1QifQ.eyJhZGRpdGlvbmFsX3BhcmFtcyI6eyJ3bF9pZCI6Ijg3MTFiOGFhLWNjNjgtNDEzYS04MDM0LWMyNzE2YTJjZTE0YSJ9LCJhdWQiOlsid2ViIl0sImV4cCI6MTc5MjUwNzM0OSwiaWF0IjoxNzkyNDg1NzQ5LCJpc3MiOiJBdXRoZW50aWNhdGlvbiIsImp0aSI6IjUyNWFmOTIxMzNmNjQ0NjM4NmFlNDU4ZjcyOGRiMjdjIiwic3ViIjoiZTM0YzI0MDM0YTg1NDEyZjhkODdjMTkxZjk5Yjk5N2UifQ.Z4Z-LzdTjd6mDwsKoX6L-bLiiV2Y0_uJAl_Y5i28UWUsluses37khA_1_cScJsE7qXKf0y_TVit8TdSnuPoGi3ZN1_peS5N4folSnm5l2FDzGyS2_dwN9qvQsiIrs_G9B7NiYoYjSCmDg8BbFFrpZO21JJEpF-itcic0sdSoXpsl0WIHxgmoKPJQHWsMM8xdIElNkNoi7elHDNAceF7uE1PsZjtxamA-WGJTy78C-JZkL9Y5P_5QkuE4hJj9MSkQMqeUvHR3xxgs8jpnLo4NGouZpK3tF4o8jRv9ZOo6llsoT4_oOCJ5OxIdA8WmKfzG6G18Sp4BL9vcbnJsae_RdmG8OSyUgEbDEyoPEdk3MYrbxoYZeeI616d9XiMG_zNMayU5vdrv3CAKhEzJuKnEIEmPcbV3U6AgLgcM_6jyYdwQBOeNymZ_G8vuxw4fe0wiBSsat5gPQ0pAiZzCIbprtyq0s_UvNiUvTl1W7Av2ZwKQafeFt0idz4ZGOig-x45JWVehxbKAnqan7k2Leu06chD-ZqBlP8hwLOgtpOur6DWq0XxHXKlipxHCvP1crjbh1Rv1M9YGdfooVGzFXtE2a8Wo00A_ck8K1OEcHTqrn3sLKSWHxI8hTWUxigINczeVZYAZB6n1hJfkvlalqBtX7dJAVXSog7xFOZ605HtNGWA"
fi

echo ""
echo "=========================================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting XAUUSD Update"
echo "=========================================================="

bash update_xauusd.sh
