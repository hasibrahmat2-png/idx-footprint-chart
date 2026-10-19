#!/usr/bin/env python3
"""
bsjp_screener_engine.py - Mechanical BSJP (Beli Sore Jual Pagi) Screener Engine
Reverse-engineered from Retail VIP Telegram Channels (Remora, Fortis, Stockwise, Michael Yeoh, Saham AS)
Enhanced with Multi-Level Forensic Filters: Macro Bandarmology, Meso SMC Structure, and Micro Pre-Closing Tape.

Execution Window: Run at 15:51 - 15:55 WIB (10:51 - 10:55 Egypt Time).
Target: Buy at Closing Auction Match Price (IEP), Sell at Day T+1 Opening (09:00 - 09:30 WIB) TP 1-3%.
"""

import os
import sys
import json
import glob
from pathlib import Path
import pandas as pd
import numpy as np

BASE_DIR = Path(__file__).resolve().parent

def run_bsjp_screener(public_dir=None, min_tval=3_500_000_000, min_freq=1500):
    if public_dir is None:
        public_dir = BASE_DIR / "indicator-examples" / "public"
    
    files = glob.glob(str(public_dir / "*_1d.json"))
    if not files:
        print(f"[!] No daily JSON files found in {public_dir}")
        return []
    
    candidates = []
    
    for filepath in files:
        sym = os.path.basename(filepath).replace("_1d.json", "")
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                bars = json.load(fp=f)
            if not bars or len(bars) < 20:
                continue
            
            df = pd.DataFrame(bars)
            curr = df.iloc[-1]
            prev = df.iloc[-2]
            
            close = float(curr.get('close', 0))
            open_p = float(curr.get('open', 0))
            high = float(curr.get('high', 0))
            low = float(curr.get('low', 0))
            vol = float(curr.get('volume', 0))
            tval = float(curr.get('value', 0))
            freq = float(curr.get('frequency', 0))
            chg_pct = float(curr.get('change_percentage', 0))
            
            # -------------------------------------------------------------
            # PILAR 1: Filter Semesta & Likuiditas Retail-Safe
            # -------------------------------------------------------------
            # Harga terjangkau untuk ritel (Fraksi 1, 2, 5: Rp 50 - Rp 600)
            if not (50 <= close <= 600):
                continue
            # Turnover memadai agar likuid bagi ribuan follower (>= Rp 3.5 Miliar)
            if tval < min_tval:
                continue
            # Tape velocity / Frekuensi aktif (>= 1,500 trade)
            if freq < min_freq:
                continue
            
            # -------------------------------------------------------------
            # PILAR 2: Filter Struktur Tren Meso (EMA20 & EMA7 Markup Regime)
            # -------------------------------------------------------------
            ema20 = df['close'].ewm(span=20, adjust=False).mean().iloc[-1]
            ema7 = df['close'].ewm(span=7, adjust=False).mean().iloc[-1]
            if close < ema20:
                continue  # Tolak saham downtrend di bawah MA20
            
            # -------------------------------------------------------------
            # PILAR 3: Filter Volume Spike Harian (>= 1.3x Vol MA5)
            # -------------------------------------------------------------
            vol_ma5 = df['volume'].rolling(5).mean().iloc[-1]
            vol_ratio = vol / vol_ma5 if vol_ma5 > 0 else 1.0
            if vol_ratio < 1.3:
                continue
            
            # -------------------------------------------------------------
            # PILAR 4: Filter Anti-Jebakan (Candle Shape & Upper Shadow Guard)
            # -------------------------------------------------------------
            rng = high - low
            upper_shadow = ((high - close) / rng * 100) if rng > 0 else 0
            pos_in_range = ((close - low) / rng * 100) if rng > 0 else 100
            
            # Blacklist Shooting Star / Volume Climax (Wick atas > 30% adalah jebakan cuci gudang!)
            if upper_shadow > 30.0:
                continue
            # Harus tutup di kuartil atas rentang hari (>= 65%)
            if pos_in_range < 65.0:
                continue
            
            # -------------------------------------------------------------
            # PILAR 5: Footprint & Orderflow Pre-Closing Check (Levels)
            # -------------------------------------------------------------
            levels = curr.get('levels', [])
            bid_support_score = 0
            if levels and isinstance(levels, list):
                # Periksa ketebalan bid di harga close
                for lvl in levels:
                    if lvl.get('price') == close:
                        b_vol = lvl.get('bidVolume', 0)
                        a_vol = lvl.get('askVolume', 0)
                        bid_support_score = b_vol / (a_vol + 1)
            
            # Lolos semua kualifikasi
            candidates.append({
                'ticker': sym,
                'close': close,
                'chg_pct': round(chg_pct, 2),
                'tval_miliar': round(tval / 1e9, 2),
                'freq': int(freq),
                'vol_ratio_5d': round(vol_ratio, 2),
                'pos_in_range': round(pos_in_range, 1),
                'upper_shadow': round(upper_shadow, 1),
                'c_gt_ema7': close >= ema7,
                'bid_support_score': round(bid_support_score, 2)
            })
            
        except Exception:
            continue
            
    df_res = pd.DataFrame(candidates)
    if not df_res.empty:
        # Urutkan berdasarkan kombinasi volume ratio dan posisi penutupan
        df_res['score'] = (df_res['vol_ratio_5d'] * 0.4) + (df_res['pos_in_range'] * 0.4) + (df_res['chg_pct'] * 0.2)
        df_res = df_res.sort_values('score', ascending=False).reset_index(drop=True)
    
    return df_res

if __name__ == "__main__":
    print("=" * 70)
    print("  IDX BSJP (BELI SORE JUAL PAGI) REVERSE-ENGINEERED SCREENER ENGINE")
    print("=" * 70)
    df_out = run_bsjp_screener()
    if df_out.empty:
        print("[*] Tidak ada kandidat yang memenuhi filter ketat pada data terkini.")
    else:
        print(f"\n[+] Ditemukan {len(df_out)} Saham Lolos Kualifikasi BSJP:")
        print(df_out[['ticker', 'close', 'chg_pct', 'tval_miliar', 'freq', 'vol_ratio_5d', 'pos_in_range', 'upper_shadow', 'score']].to_string())
