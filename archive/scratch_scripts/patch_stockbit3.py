import re

with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    content = f.read()

new_magic = """                # ==== USER MAGIC RETRY LOGIC ====
                if not rows:
                    last_time = getattr(sys.modules[__name__], 'last_recorded_time', 'Belum ada data')
                    print(f"\\n[!] Array kosong (Waktu terakhir: {last_time}). Mencoba menembus stealth ban...")
                    
                    success = False
                    for retry in range(1, 6):
                        print(f"  -> Menunggu 60 detik (Percobaan {retry}/5)...")
                        time.sleep(60)
                        
                        payload = request_json(build_url(symbol, cursor, target_date=target_date), token)
                        data, rows = extract_page(payload)
                        
                        if rows:
                            print(f"\\n[BINGO!] Data berhasil didapatkan setelah {retry} menit!")
                            success = True
                            break
                            
                    if not success:
                        print(f"\\n[GAGAL] Setelah 5 menit, tidak ada data baru.")
                        is_finished = input("Apakah hari ini SUDAH SELESAI atau Libur? [y/N]: ").strip().lower()
                        if is_finished == 'y':
                            print("Berpindah ke hari berikutnya...")
                            break
                        else:
                            print("Melanjutkan ke hari berikutnya meski belum selesai...")
                            break
                # ================================"""

content = re.sub(r"\s*# ==== USER MAGIC RETRY LOGIC ====.+?# ================================", new_magic, content, flags=re.DOTALL)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(content)

