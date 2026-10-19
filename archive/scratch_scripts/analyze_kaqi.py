import pandas as pd

df = pd.read_csv('/home/hasibrahmat2/lightweight-charts-master/data/KAQI.csv', parse_dates=['date'])
df = df.set_index('date')

print("Recent 60 days max high (Resistance):", df['high'].tail(60).max())
print("Recent 60 days min low (Support):", df['low'].tail(60).min())

print("\nRecent 120 days max high (Resistance):", df['high'].tail(120).max())
print("Recent 120 days min low (Support):", df['low'].tail(120).min())

print("\nLast 10 days of data:")
print(df[['open', 'high', 'low', 'close', 'volume']].tail(10))

peaks = df[df['high'] >= 100].tail(200)
print(peaks[['high', 'close', 'volume']])
