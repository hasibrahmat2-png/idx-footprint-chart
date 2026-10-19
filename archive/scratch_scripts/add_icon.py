with open("update_all.sh", "r") as f:
    text = f.read()

text = text.replace('process_ticker "ASII" "ASII_running_trades"\n', 'process_ticker "ASII" "ASII_running_trades"\nprocess_ticker "ICON" "ICON_running_trades"\n')

with open("update_all.sh", "w") as f:
    f.write(text)

