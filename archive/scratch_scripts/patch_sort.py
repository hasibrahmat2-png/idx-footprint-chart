with open('my-footprint-demo.html', 'r') as f:
    content = f.read()

# 1. Update the table headers to be clickable
old_thead = """                <thead>
                    <tr>
                        <th>Sym</th>
                        <th>Price</th>
                        <th id="dynamic-header">%Chg</th>
                        <th title="Value">Val</th>
                        <th title="Volume">Vol</th>
                        <th title="Frequency">Frq</th>
                        <th title="Net Foreign">N.F.</th>
                    </tr>
                </thead>"""
new_thead = """                <thead>
                    <tr>
                        <th style="cursor:pointer;" onclick="setSort('symbol')">Sym</th>
                        <th style="cursor:pointer;" onclick="setSort('price')">Price</th>
                        <th style="cursor:pointer;" onclick="setSort('change_percentage')">%Chg</th>
                        <th style="cursor:pointer;" onclick="setSort('value')" title="Value">Val</th>
                        <th style="cursor:pointer;" onclick="setSort('volume')" title="Volume">Vol</th>
                        <th style="cursor:pointer;" onclick="setSort('frequency')" title="Frequency">Frq</th>
                        <th style="cursor:pointer;" onclick="setSort('net_foreign')" title="Net Foreign">N.F.</th>
                    </tr>
                </thead>"""
content = content.replace(old_thead, new_thead)

# 2. Hide the old sidebar tabs since we don't need them if we have column sorting
old_tabs = """        <div class="sidebar-tabs">
            <button class="tab-btn active" data-sort="gainer">Top Gainer</button>
            <button class="tab-btn" data-sort="loser">Top Loser</button>
            <button class="tab-btn" data-sort="value">Top Value</button>
            <button class="tab-btn" data-sort="volume">Top Vol</button>
            <button class="tab-btn" data-sort="freq">Top Freq</button>
            <button class="tab-btn" data-sort="netbuy">Net F.Buy</button>
            <button class="tab-btn" data-sort="netsell">Net F.Sell</button>
        </div>"""
new_tabs = """        <!-- Tabs removed in favor of column sorting -->"""
content = content.replace(old_tabs, new_tabs)

# 3. Replace the JS sorting logic
old_js_start = """        let currentSort = 'gainer';"""
old_js_end = """        document.querySelectorAll('.tab-btn').forEach(btn => {"""
new_js = """        let sortKey = 'change_percentage';
        let sortDir = 'desc'; // 'asc' or 'desc'
        
        window.setSort = function(key) {
            if (sortKey === key) {
                sortDir = sortDir === 'desc' ? 'asc' : 'desc';
            } else {
                sortKey = key;
                sortDir = 'desc';
            }
            renderScreener();
        };"""
# We must carefully replace
import re
content = re.sub(r"let currentSort = 'gainer';.*?document\.getElementById\('close-sidebar-btn'\)\.addEventListener\('click', \(\) => \{\n\s*sidebar\.style\.display = 'none';\n\s*\}\);", 
                 "let sortKey = 'change_percentage';\n        let sortDir = 'desc';\n        window.setSort = function(key) {\n            if (sortKey === key) {\n                sortDir = sortDir === 'desc' ? 'asc' : 'desc';\n            } else {\n                sortKey = key;\n                sortDir = 'desc';\n            }\n            renderScreener();\n        };\n        document.getElementById('close-sidebar-btn').addEventListener('click', () => { sidebar.style.display = 'none'; });", content, flags=re.DOTALL)

# Remove the tab listener
content = re.sub(r"document\.querySelectorAll\('\.tab-btn'\)\.forEach\(btn => \{.*?\}\);", "", content, flags=re.DOTALL)

# Replace renderScreener entirely
old_render = """        function renderScreener() {"""
import re
# We'll replace everything from renderScreener() { to the end of it
# Wait, it's safer to just replace using string splits
parts = content.split("function renderScreener() {")
if len(parts) == 2:
    tail_parts = parts[1].split("        // ==============================================", 1)
    if len(tail_parts) == 2:
        new_render_func = """
            let sorted = [...screenerData];
            
            sorted.sort((a, b) => {
                let valA = a[sortKey];
                let valB = b[sortKey];
                if (typeof valA === 'string') {
                    return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                }
                return sortDir === 'asc' ? valA - valB : valB - valA;
            });
            
            // Render top 100 to give plenty of scrollable results
            screenerTbody.innerHTML = sorted.slice(0, 100).map(item => {
                let nfColor = item.net_foreign > 0 ? 'val-pos' : (item.net_foreign < 0 ? 'val-neg' : '');
                let chgColor = item.change_percentage > 0 ? 'val-pos' : (item.change_percentage < 0 ? 'val-neg' : '');

                return `<tr onclick="document.getElementById('ticker-input').value='${item.symbol}'; document.getElementById('ticker-input').dispatchEvent(new Event('change'))">
                    <td>${item.symbol}</td>
                    <td>${item.price}</td>
                    <td class="${chgColor}">${(item.change_percentage||0).toFixed(2)}%</td>
                    <td>${formatNumber(item.value)}</td>
                    <td>${formatNumber(item.volume)}</td>
                    <td>${formatNumber(item.frequency)}</td>
                    <td class="${nfColor}">${formatNumber(item.net_foreign)}</td>
                </tr>`;
            }).join('');
        }
"""
        content = parts[0] + "function renderScreener() {" + new_render_func + "        // ==============================================" + tail_parts[1]


with open('my-footprint-demo.html', 'w') as f:
    f.write(content)
