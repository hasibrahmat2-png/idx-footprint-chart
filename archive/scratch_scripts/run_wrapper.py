import sys
import getpass
import builtins
import importlib.util
from pathlib import Path

# Load scraper
spec = importlib.util.spec_from_file_location("scraper", "/home/hasibrahmat2/trading_script/tools/stockbit_running_trade_scraper_v2.py")
scraper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scraper)

# Mock getpass
TOKEN = "eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6ImZkRWFhS1ROOWpDb3N2V0IiLCJkdmMiOiI0ZjY5Yzk2MDg2YWU4YWNiODU3MWQxM2I2YjY4OTBiNiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4Mzg5NjA1LCJpYXQiOjE3ODgzMDMyMDUsImlzcyI6IlNUT0NLQklUIiwianRpIjoiNTEzNDJiMzAtZjUwMS00MDA5LWIyNjctMzMyYTUzZTNmODYwIiwibmJmIjoxNzg4MzAzMjA1LCJ2ZXIiOiJ2MSJ9.T7UQry2Wq9hPLWN5KbEshleeD-atPkKf4p0dUU7qZdtBtkemYnq9wVVdN9YHZrqrR54bgq3Ync6hUJfzOPh-WBDSdjoIs1w6mEa0yivnDBe8djrFzIKaF-rXAI_05V2J2nivaVKDMqIWqDBD0IT8pVll44wD6ln9JL-ynYRcaqJs_CwCfQUqBrPDZlb8UbZFlsFXEZg32Paqy6CDVevdGnuvoR2H0lyZ1sCEre4a_oSd2LsCH59E_DYZVQ0DGohcY4AGA-LmZGaBldkl_aMBJiNlexfr2pc1_ZHj5oBtJ_QK01w50lsRUTnD2WkB_cz4YZTrORxLGG4UbTKtJI-Sew"
scraper.getpass.getpass = lambda prompt="": TOKEN
builtins.input = lambda prompt="": "KAQI"

sys.argv = ["stockbit_running_trade_scraper_v2.py", "KAQI", "-m", "2026-09", "-o", "KAQI_running_trades", "--delay", "1.5"]
scraper.main(sys.argv[1:])
