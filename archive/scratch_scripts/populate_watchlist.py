#!/usr/bin/env python3
"""
populate_watchlist.py - Populate Stockbit Watchlist with symbols from ihsg_list.csv
"""

import csv
import json
import os
import sys
import time
import urllib.request
import urllib.error

TOKEN = os.environ.get("STOCKBIT_TOKEN", "eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6IlBRWDhnME1GUE9PankybGQiLCJkdmMiOiI0ZjY5Yzk2MDg2YWU4YWNiODU3MWQxM2I2YjY4OTBiNiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4ODE0Mzk4LCJpYXQiOjE3ODg3Mjc5OTgsImlzcyI6IlNUT0NLQklUIiwianRpIjoiZjgzZWVmODctNDU5YS00YTI1LWE4YTEtNjA0MjUwZGExMThmIiwibmJmIjoxNzg4NzI3OTk4LCJ2ZXIiOiJ2MSJ9.IhiT6reQrECHp5zASYVXqDYOCERWNSCPDV-59rk_l80IGgz9A5tRTxO9mmyGTGvI2KXQ6gywFNKHZ9qUjruIk4q4rNp2DZecxF2quHDnZJNx-TeNqZQd6U1JiwS2pTec5ZIGd9LCbEUH2teA0sNeNqTYkcEjHWeRv0U_VLkl0H20lC1uFX3wNKn0kiGEyK4olWC3dgadIxxZliFjh7Q_UQ6QQeMjJDORFOi-YnTnMi5EYO7ujQEzDYsyjls-YfZyfZZiVgVuKPKnbI35VugcTPLc1m4WFYTXVwLRd1w9qgZRPIJ_QdVh-rh5nJBRk76ph6N-a38pzAIdsa8DteKclA")
WATCHLIST_ID = 17872855
HEADERS = {
    "Accept": "application/json",
    "Authorization": f"Bearer {TOKEN}",
    "Origin": "https://stockbit.com",
    "Referer": "https://stockbit.com/",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Content-Type": "application/json"
}

ID_CACHE_FILE = "stockbit_company_ids.json"


def load_company_id_cache():
    if os.path.exists(ID_CACHE_FILE):
        try:
            with open(ID_CACHE_FILE, "r") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_company_id_cache(cache):
    with open(ID_CACHE_FILE, "w") as f:
        json.dump(cache, f, indent=2)


def get_existing_watchlist_symbols(wl_id):
    url = f"https://exodus.stockbit.com/watchlist/{wl_id}?limit=500"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            results = data.get("data", {}).get("result", [])
            return set(item.get("symbol", "").upper() for item in results if item.get("symbol"))
    except Exception as e:
        print(f"[!] Warning checking existing watchlist: {e}")
        return set()


def search_company_id(symbol, wl_id):
    url = f"https://exodus.stockbit.com/watchlist/search/company?keyword={symbol}&page=1&watchlist_id={wl_id}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            companies = data.get("data", {}).get("companies", [])
            for c in companies:
                if c.get("name", "").upper() == symbol:
                    return str(c.get("id"))
            if companies:
                # If exact match not found, take the first one whose name matches
                for c in companies:
                    if symbol in c.get("name", "").upper():
                        return str(c.get("id"))
                return str(companies[0].get("id"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            print(f"\n[429] Rate limit hit on search {symbol}, sleeping 10s...")
            time.sleep(10)
            return search_company_id(symbol, wl_id)
        print(f"\n[!] Search HTTPError for {symbol}: {e.code}")
    except Exception as e:
        print(f"\n[!] Search Error for {symbol}: {e}")
    return None


def add_company_to_watchlist(wl_id, company_id):
    url = f"https://exodus.stockbit.com/watchlist/{wl_id}/company/item"
    data = json.dumps({"company_id": str(company_id)}).encode()
    req = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req) as resp:
            return True, "Added"
    except urllib.error.HTTPError as e:
        if e.code == 400:
            # Check if already in watchlist
            err_body = e.read().decode(errors="replace")
            if "sudah ada" in err_body:
                return True, "Already in watchlist"
            return False, err_body
        elif e.code == 429:
            print(f"\n[429] Rate limit hit on add {company_id}, sleeping 10s...")
            time.sleep(10)
            return add_company_to_watchlist(wl_id, company_id)
        return False, f"HTTP {e.code}"
    except Exception as e:
        return False, str(e)


def main():
    print(f"=== Populating Stockbit Watchlist ID {WATCHLIST_ID} ===")
    
    # 1. Read symbols from ihsg_list.csv
    csv_path = "ihsg_list.csv"
    if not os.path.exists(csv_path):
        print(f"[!] File not found: {csv_path}")
        sys.exit(1)
        
    symbols = []
    with open(csv_path, "r", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            sym = row[0].strip().upper()
            if sym and sym != "SYMBOL":
                symbols.append(sym)
                
    unique_symbols = list(dict.fromkeys(symbols))
    total = len(unique_symbols)
    print(f"Total target symbols to add: {total}")
    
    # 2. Check already added symbols
    existing = get_existing_watchlist_symbols(WATCHLIST_ID)
    print(f"Currently in Watchlist: {len(existing)} stocks ({', '.join(sorted(existing)[:5])}...)")
    
    # 3. Load company id cache
    id_cache = load_company_id_cache()
    print(f"Loaded {len(id_cache)} cached company IDs")
    
    added_count = 0
    skipped_count = 0
    failed_symbols = []
    
    for idx, sym in enumerate(unique_symbols, 1):
        if sym in existing:
            skipped_count += 1
            continue
            
        # Get ID
        cid = id_cache.get(sym)
        if not cid:
            cid = search_company_id(sym, WATCHLIST_ID)
            if cid:
                id_cache[sym] = cid
                save_company_id_cache(id_cache)
            time.sleep(0.15)
            
        if not cid:
            print(f"[{idx}/{total}] ⚠️ Could not find ID for {sym}")
            failed_symbols.append(sym)
            continue
            
        # Add to watchlist
        ok, msg = add_company_to_watchlist(WATCHLIST_ID, cid)
        if ok:
            existing.add(sym)
            added_count += 1
            print(f"[{idx}/{total}] ✅ {sym} (ID {cid}) -> {msg}")
        else:
            print(f"[{idx}/{total}] ❌ {sym} (ID {cid}) -> {msg}")
            failed_symbols.append(sym)
            
        time.sleep(0.20)
        
    print("\n=== Finished Watchlist Population ===")
    print(f"Newly Added: {added_count}")
    print(f"Already Present: {skipped_count}")
    print(f"Total Now in Watchlist: {len(existing)}")
    if failed_symbols:
        print(f"Failed Symbols ({len(failed_symbols)}): {', '.join(failed_symbols)}")


if __name__ == "__main__":
    main()
