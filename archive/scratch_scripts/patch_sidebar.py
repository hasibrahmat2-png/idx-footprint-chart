import re

with open('my-footprint-demo.html', 'r') as f:
    content = f.read()

# 1. Update CSS
css_update = """
        #main-layout {
            display: flex;
            width: 100vw;
            height: 100vh;
            overflow: hidden;
        }
        #chart-container {
            flex: 1;
            height: 100%;
            position: relative;
            min-width: 0; /* Important for flex child */
        }
        #sidebar {
            width: 350px;
            background: #fff;
            border-left: 1px solid #ccc;
            display: none;
            flex-direction: column;
            overflow: hidden;
        }
        #sidebar-header {
            padding: 10px;
            font-weight: bold;
            border-bottom: 1px solid #ddd;
            font-size: 16px;
            display: flex;
            justify-content: space-between;
        }
        .sidebar-tabs {
            display: flex;
            flex-wrap: wrap;
            border-bottom: 1px solid #ddd;
            background: #f9f9f9;
        }
        .tab-btn {
            flex: 1 0 33%;
            border: none;
            background: none;
            padding: 8px 4px;
            font-size: 11px;
            cursor: pointer;
            text-align: center;
            border-right: 1px solid #ddd;
            border-bottom: 1px solid #ddd;
            box-sizing: border-box;
        }
        .tab-btn.active {
            background: #fff;
            font-weight: bold;
            border-bottom: 2px solid #2196F3;
        }
        .sidebar-table-wrap {
            flex: 1;
            overflow-y: auto;
        }
        .sidebar-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        .sidebar-table th {
            position: sticky;
            top: 0;
            background: #eee;
            padding: 6px;
            text-align: right;
            border-bottom: 1px solid #ddd;
        }
        .sidebar-table th:first-child { text-align: left; }
        .sidebar-table td {
            padding: 6px;
            text-align: right;
            border-bottom: 1px solid #eee;
            cursor: pointer;
        }
        .sidebar-table td:first-child { text-align: left; font-weight: bold; }
        .sidebar-table tr:hover { background: #f5f5f5; }
        
        /* Format positive/negative */
        .val-pos { color: #4CAF50; }
        .val-neg { color: #FF5252; }
"""
content = content.replace("        #chart-container {", css_update + "        /* old #chart-container replaced */\n        .hidden-chart-container {")

# 2. Update HTML
html_old = """    <div id="chart-container">"""
html_new = """    <div id="main-layout">
    <div id="chart-container">"""
content = content.replace(html_old, html_new)

toolbar_old = """            <button class="btn tf-btn" data-tf="1d">1D</button>"""
toolbar_new = """            <button class="btn tf-btn" data-tf="1d">1D</button>
            <div style="border-left: 1px solid #ccc; margin: 0 5px;"></div>
            <button id="screener-btn" class="btn">Screener</button>"""
content = content.replace(toolbar_old, toolbar_new)

legend_close_old = """        <div id="legend"></div>
    </div>"""
legend_close_new = """        <div id="legend"></div>
    </div>
    
    <div id="sidebar">
        <div id="sidebar-header">
            <span>Movers</span>
            <span style="cursor:pointer;" id="close-sidebar-btn">✖</span>
        </div>
        <div class="sidebar-tabs">
            <button class="tab-btn active" data-sort="gainer">Top Gainer</button>
            <button class="tab-btn" data-sort="loser">Top Loser</button>
            <button class="tab-btn" data-sort="value">Top Value</button>
            <button class="tab-btn" data-sort="volume">Top Vol</button>
            <button class="tab-btn" data-sort="freq">Top Freq</button>
            <button class="tab-btn" data-sort="netbuy">Net F.Buy</button>
            <button class="tab-btn" data-sort="netsell">Net F.Sell</button>
        </div>
        <div class="sidebar-table-wrap">
            <table class="sidebar-table">
                <thead>
                    <tr>
                        <th>Sym</th>
                        <th>Price</th>
                        <th id="dynamic-header">%Chg</th>
                    </tr>
                </thead>
                <tbody id="screener-tbody">
                    <!-- Populated by JS -->
                </tbody>
            </table>
        </div>
    </div>
    </div> <!-- main-layout end -->"""
content = content.replace(legend_close_old, legend_close_new)

# 3. Add JS for Screener
js_new = """
        // =============== SCREENER LOGIC ===============
        let screenerData = [];
        let currentSort = 'gainer';
        const sidebar = document.getElementById('sidebar');
        const screenerTbody = document.getElementById('screener-tbody');
        const dynamicHeader = document.getElementById('dynamic-header');
        
        document.getElementById('screener-btn').addEventListener('click', () => {
            if(sidebar.style.display === 'flex') {
                sidebar.style.display = 'none';
            } else {
                sidebar.style.display = 'flex';
                if(screenerData.length === 0) loadScreenerData();
            }
        });
        
        document.getElementById('close-sidebar-btn').addEventListener('click', () => {
            sidebar.style.display = 'none';
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentSort = e.target.getAttribute('data-sort');
                renderScreener();
            });
        });

        async function loadScreenerData() {
            try {
                const res = await fetch('screener_data.json');
                screenerData = await res.json();
                renderScreener();
            } catch(e) {
                console.error("Failed to load screener data", e);
            }
        }
        
        function formatNumber(num) {
            if(Math.abs(num) >= 1e9) return (num/1e9).toFixed(1) + 'B';
            if(Math.abs(num) >= 1e6) return (num/1e6).toFixed(1) + 'M';
            if(Math.abs(num) >= 1e3) return (num/1e3).toFixed(1) + 'K';
            return num.toString();
        }

        function renderScreener() {
            let sorted = [...screenerData];
            let valueKey = 'change_percentage';
            let headerText = '%Chg';
            let isFormatted = false;

            if(currentSort === 'gainer') {
                sorted.sort((a,b) => b.change_percentage - a.change_percentage);
                valueKey = 'change_percentage'; headerText = '%Chg';
            }
            else if(currentSort === 'loser') {
                sorted.sort((a,b) => a.change_percentage - b.change_percentage);
                valueKey = 'change_percentage'; headerText = '%Chg';
            }
            else if(currentSort === 'value') {
                sorted.sort((a,b) => b.value - a.value);
                valueKey = 'value'; headerText = 'Val'; isFormatted = true;
            }
            else if(currentSort === 'volume') {
                sorted.sort((a,b) => b.volume - a.volume);
                valueKey = 'volume'; headerText = 'Vol'; isFormatted = true;
            }
            else if(currentSort === 'freq') {
                sorted.sort((a,b) => b.frequency - a.frequency);
                valueKey = 'frequency'; headerText = 'Freq'; isFormatted = true;
            }
            else if(currentSort === 'netbuy') {
                sorted.sort((a,b) => b.net_foreign - a.net_foreign);
                valueKey = 'net_foreign'; headerText = 'N.F'; isFormatted = true;
            }
            else if(currentSort === 'netsell') {
                sorted.sort((a,b) => a.net_foreign - b.net_foreign);
                valueKey = 'net_foreign'; headerText = 'N.F'; isFormatted = true;
            }
            
            dynamicHeader.innerText = headerText;
            
            // Render top 50
            screenerTbody.innerHTML = sorted.slice(0, 50).map(item => {
                let val = item[valueKey];
                let displayVal = isFormatted ? formatNumber(val) : val.toFixed(2) + '%';
                
                let colorClass = '';
                if(!isFormatted || currentSort === 'netbuy' || currentSort === 'netsell') {
                    if(val > 0) colorClass = 'val-pos';
                    else if(val < 0) colorClass = 'val-neg';
                }
                
                return `<tr onclick="document.getElementById('ticker-input').value='${item.symbol}'; document.getElementById('ticker-input').dispatchEvent(new Event('change'))">
                    <td>${item.symbol}</td>
                    <td>${item.price}</td>
                    <td class="${colorClass}">${displayVal}</td>
                </tr>`;
            }).join('');
        }
        // ==============================================
"""

content = content.replace("const footprintOptions = {", js_new + "\n            const footprintOptions = {")

with open('my-footprint-demo.html', 'w') as f:
    f.write(content)

print("Patch completed successfully")
