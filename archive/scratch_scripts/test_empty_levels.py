import json
with open('indicator-examples/public/KAQI_1d.json') as f:
    data = json.load(f)
    print(data[-1])
