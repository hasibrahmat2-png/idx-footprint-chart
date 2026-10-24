#!/usr/bin/env bash
# ==============================================================================
# Helper Script: Validasi & Update Exness Token secara Aman dan Instan
# Penggunaan:
#   bash set_exness_token.sh
#   atau: bash set_exness_token.sh "eyJh..."
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RAW_TOKEN="$1"
if [ -z "$RAW_TOKEN" ]; then
    echo "=========================================================="
    echo "  EXNESS TOKEN UPDATER (AUTO VALIDASI & SYNC)"
    echo "=========================================================="
    echo "Salin token dari Exness Web Terminal (Request Header -> authorization)."
    read -r -p "Tempel Exness Token: " RAW_TOKEN
fi

# 1. Bersihkan token dari prefix Bearer, spasi, dan tanda kutip
CLEAN_TOKEN=$(echo "$RAW_TOKEN" | tr -d '\r\n' | sed -e 's/^[bB]earer //' -e 's/^["'"'"']//' -e 's/["'"'"']$//' | tr -d ' ')

if [ -z "$CLEAN_TOKEN" ]; then
    echo "[Error] Token kosong! Pembaruan dibatalkan."
    exit 1
fi

# 2. Validasi format JWT & periksa masa berlaku menggunakan Python
python3 -c "
import sys, json, base64, time
from datetime import datetime, timezone, timedelta

token = '''$CLEAN_TOKEN'''.strip()
parts = token.split('.')
if len(parts) != 3:
    print('[Error] Format token salah! JWT harus memiliki 3 bagian dipisah titik.', file=sys.stderr)
    sys.exit(1)

try:
    payload_b64 = parts[1]
    payload_b64 += '=' * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64.encode('utf-8')).decode('utf-8'))
except Exception as e:
    print(f'[Error] Gagal membaca isi payload token JWT: {e}', file=sys.stderr)
    sys.exit(1)

exp = payload.get('exp')
now = int(time.time())

if not exp:
    print('[Peringatan] Token tidak memiliki timestamp kedaluwarsa (exp).')
else:
    diff = exp - now
    wib = timezone(timedelta(hours=7))
    exp_dt_wib = datetime.fromtimestamp(exp, tz=wib).strftime('%Y-%m-%d %H:%M:%S WIB')
    if diff <= 0:
        print(f'[ERROR] TOKEN SUDAH KEDALUWARSA pada {exp_dt_wib} ({abs(diff)} detik lalu)!', file=sys.stderr)
        print('Silakan login ulang ke Exness Web Terminal dan ambil token baru.', file=sys.stderr)
        sys.exit(1)
    else:
        hours = diff // 3600
        mins = (diff % 3600) // 60
        print(f'[OK] Token Valid! Kedaluwarsa pada: {exp_dt_wib} (sisa {hours} jam {mins} menit)')
"

# 3. Simpan token baru ke .env secara aman (kebal terhadap karakter khusus)
python3 -c "
from pathlib import Path
env_path = Path('$SCRIPT_DIR/.env')
token = '''$CLEAN_TOKEN'''.strip()
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
echo "[Sukses] Token berhasil ditulis ke $SCRIPT_DIR/.env"

# 4. Tes koneksi langsung ke API Exness
python3 -c "
import urllib.request, json, sys

token = '''$CLEAN_TOKEN'''.strip()
url = 'https://rtapi-sg.useusecapwaskeyyepjamlaw.com/rtapi/mt5/real20/v1/accounts/159936924/positions'
headers = {
    'Authorization': f'Bearer {token}',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'
}
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=8) as resp:
        if resp.status == 200:
            data = json.loads(resp.read().decode('utf-8'))
            count = len(data.get('positions', []))
            print(f'[Sukses] Verifikasi API Exness Berhasil! Terdeteksi {count} posisi terbuka.')
except Exception as e:
    print(f'[Peringatan] Uji API gagal: {e}', file=sys.stderr)
"

# 5. Hapus file lock lama jika ada
rm -f /tmp/update_xauusd.pid /tmp/update_pairs.pid

# 6. Eksekusi update langsung agar chart web langsung sinkron
echo ""
echo "=== Menjalankan Sinkronisasi XAUUSD Sekarang ==="
export EXNESS_TOKEN="$CLEAN_TOKEN"
bash update_xauusd.sh

echo ""
echo "=========================================================="
echo "  SELESAI! Token aktif & Cron 5-menit akan berjalan lancar."
echo "=========================================================="
