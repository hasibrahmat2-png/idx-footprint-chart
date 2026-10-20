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
    export EXNESS_TOKEN="Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InVzZXIiLCJ0eXAiOiJKV1QifQ.eyJhZGRpdGlvbmFsX3BhcmFtcyI6eyJ3bF9pZCI6Ijg3MTFiOGFhLWNjNjgtNDEzYS04MDM0LWMyNzE2YTJjZTE0YSJ9LCJhdWQiOlsid2ViIl0sImV4cCI6MTc5MjUyOTA4OCwiaWF0IjoxNzkyNTA3NDg4LCJpc3MiOiJBdXRoZW50aWNhdGlvbiIsImp0aSI6IjA5MGYzNWFmZWFjMTQ3ZTRhOGM5YjNlZmUzOWExNGQxIiwic3ViIjoiZTM0YzI0MDM0YTg1NDEyZjhkODdjMTkxZjk5Yjk5N2UifQ.MEiiaw4OhXCnj2FMECBRTnH07ITPMA3rmBk5TYeoDKf7i8tZHu7zOJ14UeaukQgdqacGg7xW2iCXKeva-rw6tB3LDTB-25w94D-lnTpwpTLaDwbY28fdQZ5TwWuCV9h6zizarivz50Ez3IMBecVNnCQw5vZcel9Ame3T4jIldEwc6ncR4A5oMt7Cb8bTSoivStXYcD2PvuhuOyIl08qj8D4ep0do0nTOB3chbS6TqZHsIFHh8C1HDeFMg_Kyx0d2nhsMxQZOXvMH0_bLpaO9UF0xSRrxheQsvrPDjRCYwn_3ABTR5lUegHMnErAW4WmM8uBnKPSagNVkMDIe2Ek4pvijb6hz_WQ7T-fhjjeTfeGDwGku5g_n0jVDZHv_g3prd5y0XPoNYxNy9E7Tz8RKQbh0ZUcR0FrYE4FPvWiIiPCgFatfbY-fg_IXigibpqWe82BbJvrFS5QkEDtsEuqrBLXw3n2XV60AmUsuvkNY3jb2SPYtGOLW_QTj0zBfjS_6J-EFVy9KHO2V-0VixMQNnUNAz-NUPUQV8CDsP5UzU-x7nBirjFwZyhl3BtW38oIgvRD5ZHUemS2lBOLDYs9eiXgw96BvlHIDyrAOEQLEY17ZUTZB94NKH6aULaL_LutArpioe33O4H1J55458E5YCRUd0a3u0bjUIbERFfOE778"
fi

echo ""
echo "=========================================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting XAUUSD Update"
echo "=========================================================="

bash update_xauusd.sh
