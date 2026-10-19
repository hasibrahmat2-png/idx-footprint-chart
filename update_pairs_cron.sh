#!/bin/bash
# ==============================================================================
# Periodic 15-minute runner for Forex & Indices update pipeline
# Pairs: USDJPYc, EURUSDc, USTECc, US500c, US30c
# ==============================================================================
set -e

SCRIPT_DIR="/home/hasibrahmat2/lightweight-charts-master"
cd "$SCRIPT_DIR"

# Prevent overlapping runs
PIDFILE="/tmp/update_pairs.pid"
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Update pairs already running (PID: $(cat "$PIDFILE")), skipping..."
    exit 0
fi

echo "$$" > "$PIDFILE"
trap 'rm -f "$PIDFILE"' EXIT

export EXNESS_TOKEN="Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InVzZXIiLCJ0eXAiOiJKV1QifQ.eyJhZGRpdGlvbmFsX3BhcmFtcyI6eyJ3bF9pZCI6Ijg3MTFiOGFhLWNjNjgtNDEzYS04MDM0LWMyNzE2YTJjZTE0YSJ9LCJhdWQiOlsid2ViIl0sImV4cCI6MTc5MjQxNzA3MCwiaWF0IjoxNzkyMzk1NDcwLCJpc3MiOiJBdXRoZW50aWNhdGlvbiIsImp0aSI6IjgwYTRlMDVkMzE0MTQ1Y2ZiZmU2YmNhY2ZlYTc5NTJmIiwic3ViIjoiZTM0YzI0MDM0YTg1NDEyZjhkODdjMTkxZjk5Yjk5N2UifQ.szJSdN0GSxo2s8t_hNcER752afjWkAKyqN-dl4Z4dRx9T3wFeMH2aOWH3wrSc_OHX-BTCdgCP4jxgQf70FBzUwPwRdQ-xRlr2y8VhQA-aImTBR5srs2d434mYDW9UrfMkqTlFA4L-lxluRPKtQ_ZQ609wBW7kqUFspRsf33bjrt3DSybYpdma-Ig8shSPmH71Sj60YNJEKoxKBX2D57Xmx4iIzLdaKQmRqydg12G8Ziu5B_V3SI8-J7HaKqrZAf1xBqzlN52P2zaLHw70SFVUL2ZNyOFGQMEuiXVHEO_8e_o3R_05R1u4yw8YQFe_xgn1d1yCciv--rEKSFy3pNe1W1bmOOOl7o1_V-wZ-qwnCwfei_6do1fUe9lU---g9pGyX7kTanlxe654Kk2k20viB8-AuBthZGSBoEJApkhbpklkFq6A7TyTY5XuPLugmwwM7DbUQcFlUCugoAcndOQmmQlfvXUf_EBKUt2SR9BCr6DV3Gg7UQnpRP6QHT_quxRja7iZB9bw6TLuIieFoRV88gYXLawm8ekLvCfJpdPRg8lBFpUr7IZZy36W20egAjNRrKlbk1yu5wgRlZjrpKk-GGiNPvmHbP4kW7Cy_t92xxRUfHarf-fn84k8dU7WjlXbo1Jr58cmbSfJtp-cyxCsukGrRdW9D8mznsxnIcgUAk"

echo ""
echo "=========================================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting Forex & Indices Update"
echo "=========================================================="

bash update_pairs.sh
