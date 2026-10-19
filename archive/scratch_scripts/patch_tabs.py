with open('my-footprint-demo.html', 'r') as f:
    content = f.read()

# 1. Add back the HTML tabs
old_tabs = """        <!-- Tabs removed in favor of column sorting -->"""
new_tabs = """        <div class="sidebar-tabs">
            <button class="tab-btn active" data-sort="gainer">Top Gainer</button>
            <button class="tab-btn" data-sort="loser">Top Loser</button>
            <button class="tab-btn" data-sort="value">Top Value</button>
            <button class="tab-btn" data-sort="volume">Top Vol</button>
            <button class="tab-btn" data-sort="freq">Top Freq</button>
            <button class="tab-btn" data-sort="netbuy">Net F.Buy</button>
            <button class="tab-btn" data-sort="netsell">Net F.Sell</button>
        </div>"""
content = content.replace(old_tabs, new_tabs)

# 2. Add back the JS listener for tabs
js_tabs = """
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                
                let srt = e.target.getAttribute('data-sort');
                if (srt === 'gainer') { sortKey = 'change_percentage'; sortDir = 'desc'; }
                else if (srt === 'loser') { sortKey = 'change_percentage'; sortDir = 'asc'; }
                else if (srt === 'value') { sortKey = 'value'; sortDir = 'desc'; }
                else if (srt === 'volume') { sortKey = 'volume'; sortDir = 'desc'; }
                else if (srt === 'freq') { sortKey = 'frequency'; sortDir = 'desc'; }
                else if (srt === 'netbuy') { sortKey = 'net_foreign'; sortDir = 'desc'; }
                else if (srt === 'netsell') { sortKey = 'net_foreign'; sortDir = 'asc'; }
                
                renderScreener();
            });
        });
"""

# Insert right before async function loadScreenerData()
content = content.replace("        async function loadScreenerData() {", js_tabs + "\n        async function loadScreenerData() {")

with open('my-footprint-demo.html', 'w') as f:
    f.write(content)
