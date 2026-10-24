#!/bin/bash
# ==============================================================================
# Periodic 5-minute runner for XAUUSD update pipeline
# Supports cron execution and standalone loop mode (--loop / -l)
# ==============================================================================
set -e

SCRIPT_DIR="/home/hasibrahmat2/lightweight-charts-master"
cd "$SCRIPT_DIR"

# Sinkronisasi & Prioritas Token:
# 1. Jika EXNESS_TOKEN ada di environment terminal, simpan otomatis ke .env agar cron background mewarisi token ini
if [ -n "$EXNESS_TOKEN" ]; then
    CLEAN_TOKEN=$(echo "$EXNESS_TOKEN" | tr -d '\r' | sed -e 's/^Bearer //' -e 's/^"//' -e 's/"$//')
    python3 -c "
from pathlib import Path
env_path = Path('$SCRIPT_DIR/.env')
token = '''$CLEAN_TOKEN'''.strip()
if token:
    lines = []
    found = False
    if env_path.exists():
        for l in env_path.read_text(encoding='utf-8').splitlines():
            if l.strip().startswith('EXNESS_TOKEN='):
                lines.append(f'EXNESS_TOKEN=\"{token}\"')
                found = True
            else:
                lines.append(l)
    if not found:
        lines.append(f'EXNESS_TOKEN=\"{token}\"')
    env_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
"
    echo "[Sukses] Token Exness dari terminal berhasil disimpan ke $SCRIPT_DIR/.env"
else
    # 2. Jika tidak ada di env, ambil dari .env
    if [ -f "$SCRIPT_DIR/.env" ]; then
        ENV_TOKEN=$(grep -E "^EXNESS_TOKEN=" "$SCRIPT_DIR/.env" | head -n 1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" | tr -d '\r')
        if [ -n "$ENV_TOKEN" ]; then
            export EXNESS_TOKEN="$ENV_TOKEN"
        fi
    fi
fi

if [ -z "$EXNESS_TOKEN" ]; then
    echo "[Error] EXNESS_TOKEN belum dikonfigurasi di terminal maupun di $SCRIPT_DIR/.env!"
    echo "Silakan login ke Exness Web Terminal dan set token baru."
    exit 1
fi

run_once() {
    # Prevent overlapping runs
    PIDFILE="/tmp/update_xauusd.pid"
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update already running (PID: $(cat "$PIDFILE")), skipping..."
        return 0
    fi

    echo "$$" > "$PIDFILE"
    trap 'rm -f "$PIDFILE"' EXIT

    echo ""
    echo "=========================================================="
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting XAUUSD Update"
    echo "=========================================================="

    bash update_xauusd.sh
    rm -f "$PIDFILE"
}

if [ "$1" == "--loop" ] || [ "$1" == "-l" ] || [ "$1" == "--daemon" ]; then
    echo "[Daemon] Mode Loop 5-Menit XAUUSD aktif (Tekan Ctrl+C untuk berhenti)..."
    while true; do
        run_once || echo "[Peringatan] Siklus update XAUUSD mengalami kendala, mencoba lagi 5 menit berikutnya..."
        echo "[Daemon] Tidur selama 5 menit (300 detik)..."
        sleep 300
    done
else
    run_once
fi
