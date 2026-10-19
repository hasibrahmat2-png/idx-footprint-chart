import re

with open('/home/hasibrahmat2/lightweight-charts-master/my-footprint-demo.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the script tag
script_match = re.search(r'<script type="module">(.*?)</script>', content, re.DOTALL)
if script_match:
    js_content = script_match.group(1)
    # Replace CDN imports with local imports
    js_content = re.sub(r'from\s+[\'"]https://esm\.sh/lightweight-charts@[^\'"]+[\'"]', "from 'lightweight-charts'", js_content)
    js_content = re.sub(r'from\s+[\'"]https://esm\.sh/lightweight-orderflow-charts@[^\'"]+[\'"]', "from 'lightweight-orderflow-charts'", js_content)
    
    # Save main.ts
    with open('src/my-footprint-ts/main.ts', 'w', encoding='utf-8') as f:
        f.write(js_content)
        
    # Replace script in HTML
    html_content = content[:script_match.start()] + '<script type="module" src="./main.ts"></script>' + content[script_match.end():]
    
    # Fix paths for json to absolute from root or let it be relative since they are in public root
    html_content = html_content.replace("'screener_data.json'", "'/screener_data.json'")
    html_content = html_content.replace("\`${ticker}_${tf}.json\`", "\`/${ticker}_${tf}.json\`")

    with open('src/my-footprint-ts/index.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    print("Split successful!")
else:
    print("Script tag not found")
