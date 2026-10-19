with open('indicator-examples/src/my-footprint-ts/index.html', 'r') as f:
    content = f.read()

content = content.replace("✔ SMA (20)", "&nbsp;&nbsp;&nbsp;SMA (20)")
content = content.replace("✔ Median Price", "&nbsp;&nbsp;&nbsp;Median Price")

with open('indicator-examples/src/my-footprint-ts/index.html', 'w') as f:
    f.write(content)
