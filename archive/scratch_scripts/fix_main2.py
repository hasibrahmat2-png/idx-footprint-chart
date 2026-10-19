import re
with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

content = content.replace(
    'if (data[data.length - 1] && data[data.length - 1].levels) {',
    'if (data.some(d => d.levels && d.levels.length > 0)) {'
)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)

