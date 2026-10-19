with open('my-footprint-demo.html', 'r') as f:
    content = f.read()

# Replace the table headers
old_thead = """                <thead>
                    <tr>
                        <th>Sym</th>
                        <th>Price</th>
                        <th id="dynamic-header">%Chg</th>
                    </tr>
                </thead>"""
new_thead = """                <thead>
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
content = content.replace(old_thead, new_thead)

# Replace the rendering part
old_render = """                return `<tr onclick="document.getElementById('ticker-input').value='${item.symbol}'; document.getElementById('ticker-input').dispatchEvent(new Event('change'))">
                    <td>${item.symbol}</td>
                    <td>${item.price}</td>
                    <td class="${colorClass}">${displayVal}</td>
                </tr>`;"""
new_render = """                
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
                </tr>`;"""
content = content.replace(old_render, new_render)

with open('my-footprint-demo.html', 'w') as f:
    f.write(content)

