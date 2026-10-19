with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

if "localization: {" not in content:
    content = content.replace(
        "layout: {",
        "localization: { timezone: 'Asia/Jakarta' },\n                layout: {"
    )
    with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
        f.write(content)
