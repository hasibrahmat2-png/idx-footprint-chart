import re

with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    content = f.read()

# We need to change how the first payload is handled, or how empty rows are handled.
# Let's intercept the `request_json` response directly in the while loop.
# Actually, the simplest way is to rewrite the `extract_page` call or the `while True` loop.

replacement = """
                data, rows = extract_page(payload)
                
                # ==== USER MAGIC RETRY LOGIC ====
                if not rows and pages == 1:
                    print(f"\\n[!] Stockbit mengembalikan array KOSONG untuk {market_date}.")
                    is_holiday = input("Apakah hari ini benar-benar libur/suspensi? (y/N): ").strip().lower()
                    
                    if is_holiday != 'y':
                        print("Stockbit mungkin menyembunyikan data (stealth ban). Memulai trik retry 60 detik...")
                        success = False
                        for retry in range(1, 6):
                            print(f"  -> Menunggu 60 detik (Percobaan {retry}/5)...")
                            time.sleep(60)
                            
                            print("  -> Mengirim ulang request ke Stockbit...")
                            payload = request_json(build_url(symbol, cursor, target_date=target_date), token)
                            data, rows = extract_page(payload)
                            
                            if rows:
                                print(f"\\n[BINGO!] Data berhasil didapatkan setelah {retry} menit!")
                                success = True
                                break
                            else:
                                print("  -> Masih kosong...")
                                
                        if not success:
                            print(f"\\n[GAGAL] Setelah 5 menit, Stockbit tetap tidak memberikan data. Melanjutkan ke hari berikutnya...")
                # ================================

                received_rows += len(rows)

                for raw_row in rows:
"""

# The original code has:
#                 data, rows = extract_page(payload)
#                 received_rows += len(rows)
# 
#                 for raw_row in rows:

content = re.sub(
    r"\s+data, rows = extract_page\(payload\)\n\s+received_rows \+\= len\(rows\)\n\s+for raw_row in rows:",
    replacement,
    content
)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(content)

print("Patch applied successfully.")
