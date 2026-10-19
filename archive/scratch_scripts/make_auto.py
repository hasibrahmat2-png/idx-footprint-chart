import re

with open("stockbit_running_trade_scraper_v2.py", "r") as f:
    content = f.read()

old_magic = r"""                    if not success:
                        print\(f"\\n\[GAGAL\] Setelah 5 menit, tidak ada data baru\."\)
                        is_finished = input\("Apakah hari ini SUDAH SELESAI atau Libur\? \[y/N\]: "\)\.strip\(\)\.lower\(\)
                        if is_finished == 'y':
                            print\("Berpindah ke hari berikutnya\.\.\."\)
                            break
                        else:
                            print\("Melanjutkan ke hari berikutnya meski belum selesai\.\.\."\)
                            break"""

new_magic = """                    if not success:
                        print(f"\\n[GAGAL/SELESAI] Setelah 5 menit menunggu, tidak ada data baru dari Stockbit.")
                        print("Mengasumsikan hari ini sudah selesai atau libur. Otomatis berpindah ke hari berikutnya...")
                        break"""

content = re.sub(old_magic, new_magic, content)

with open("stockbit_running_trade_scraper_v2.py", "w") as f:
    f.write(content)

