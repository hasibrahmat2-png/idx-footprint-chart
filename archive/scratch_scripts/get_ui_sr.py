import json

with open('KAQI_1d.json') as f:
    data = json.load(f)

lookback = 10
res_levels = []
sup_levels = []

for i in range(lookback, len(data) - lookback):
    current = data[i]
    
    # Check Pivot High
    is_pivot_high = True
    for j in range(1, lookback + 1):
        if data[i-j]['high'] > current['high'] or data[i+j]['high'] > current['high']:
            is_pivot_high = False
            break
    if is_pivot_high:
        res_levels.append(current['high'])
        
    # Check Pivot Low
    is_pivot_low = True
    for j in range(1, lookback + 1):
        if data[i-j]['low'] < current['low'] or data[i+j]['low'] < current['low']:
            is_pivot_low = False
            break
    if is_pivot_low:
        sup_levels.append(current['low'])

# Keep order, unique, last 3
res_unique = list(dict.fromkeys(res_levels))[-3:]
sup_unique = list(dict.fromkeys(sup_levels))[-3:]

print("UI Auto Support/Resistance Lines:")
print("Resistance:", res_unique)
print("Support:", sup_unique)
