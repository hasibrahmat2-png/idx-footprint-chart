import re

with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    content = f.read()

# 1. Remove the bad PAGE_LIMIT break entirely
content = re.sub(r"\s+if len\(rows\) < PAGE_LIMIT:\n\s+break", "", content)

# 2. Fix the prompt logic to trigger on EVERY empty array, not just pages == 1
# Original: if not rows and pages == 1:
# We will replace the whole USER MAGIC block
old_magic = r"""                # ==== USER MAGIC RETRY LOGIC ====
                if not rows and pages == 1:
                    print\(f"\\n\[!\] Stockbit mengembalikan array KOSONG untuk \{market_date\}\."\)
                    is_holiday = input\("Apakah hari ini benar-benar libur/suspensi\? \(y/N\): "\)\.strip\(\)\.lower\(\)
                    
                    if is_holiday != 'y':
                        print\("Stockbit mungkin menyembunyikan data \(stealth ban\)\. Memulai trik retry 60 detik\.\.\."\)
                        success = False
                        for retry in range\(1, 6\):
                            print\(f"  -> Menunggu 60 detik \(Percobaan \{retry\}/5\)\.\.\."\)
                            time\.sleep\(60\)
                            
                            print\("  -> Mengirim ulang request ke Stockbit\.\.\."\)
                            payload = request_json\(build_url\(symbol, cursor, target_date=target_date\), token\)
                            data, rows = extract_page\(payload\)
                            
                            if rows:
                                print\(f"\\n\[BINGO!\] Data berhasil didapatkan setelah \{retry\} menit!"\)
                                success = True
                                break
                            else:
                                print\("  -> Masih kosong\.\.\."\)
                                
                        if not success:
                            print\(f"\\n\[GAGAL\] Setelah 5 menit, Stockbit tetap tidak memberikan data\. Melanjutkan ke hari berikutnya\.\.\."\)
                # ================================"""

new_magic = """                # ==== USER MAGIC RETRY LOGIC ====
                if not rows:
                    last_time = getattr(sys.modules[__name__], 'last_recorded_time', 'Belum ada data')
                    print(f"\\n[!] Stockbit mengembalikan array KOSONG untuk {market_date}.")
                    print(f"Waktu trade terakhir yang berhasil diunduh: {last_time}")
                    is_finished = input("Apakah scraping hari ini SUDAH SELESAI (sudah sampai jam 08:55 pagi)? [y/N]: ").strip().lower()
                    
                    if is_finished == 'y':
                        print("Menyelesaikan hari ini...")
                        break
                    else:
                        print("Stockbit sedang melakukan stealth ban. Memulai trik retry 60 detik...")
                        success = False
                        for retry in range(1, 6):
                            print(f"  -> Menunggu 60 detik (Percobaan {retry}/5)...")
                            import time
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
                            print(f"\\n[GAGAL] Setelah 5 menit, Stockbit tetap memblokir data. Melanjutkan ke hari berikutnya...")
                            break
                # ================================"""

# Use string replace for the magic block since regex with that much text is error prone
content = re.sub(r"\s*# ==== USER MAGIC RETRY LOGIC ====.+?# ================================", new_magic, content, flags=re.DOTALL)

# Add a tracker for the last recorded time so the user knows if they hit the morning
tracker_injection = """
                    row = normalize_row(raw_row, str(data.get("date") or market_date))
                    writer.writerow(row)
                    written_rows += 1
                    
                    import sys
                    setattr(sys.modules[__name__], 'last_recorded_time', row.get('time', '-'))
"""
content = re.sub(r"\s+row = normalize_row\(raw_row, str\(data\.get\(\"date\"\) or market_date\)\)\n\s+writer\.writerow\(row\)\n\s+written_rows \+\= 1", tracker_injection, content)


with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(content)

