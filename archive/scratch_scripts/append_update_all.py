with open("update_all.sh", "r") as f:
    lines = f.readlines()

out_lines = []
for line in lines:
    out_lines.append(line)
    if 'process_ticker "KAQI" "KAQI_running_trades"' in line:
        out_lines.append('process_ticker "BBCA" "BBCA_running_trades"\n')
        out_lines.append('process_ticker "ASII" "ASII_running_trades"\n')

with open("update_all.sh", "w") as f:
    f.writelines(out_lines)

