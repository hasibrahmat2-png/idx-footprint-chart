import re
with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

replacement = """                    if (fullBar.volume !== undefined) {
                        totalVolume = fullBar.volume;
                    } else if (fullBar.levels) {
                        totalVolume = fullBar.levels.reduce((acc, lvl) => acc + lvl.bidVolume + lvl.askVolume, 0);
                    }
                    
                    if (fullBar.average !== undefined) {
                        const avg = fullBar.average;
                        const val = formatVolume(fullBar.value);
                        const freq = fullBar.frequency;
                        const chg = fullBar.change;
                        const pct = fullBar.change_percentage;
                        const fBuy = formatVolume(fullBar.foreign_buy);
                        const fSell = formatVolume(fullBar.foreign_sell);
                        const netF = formatVolume(fullBar.net_foreign);
                        
                        const chgColor = chg >= 0 ? '#4CAF50' : '#FF5252';
                        const netFColor = fullBar.net_foreign >= 0 ? '#4CAF50' : '#FF5252';

                        extraHtml = `
                            <br>
                            <span style="color: #666; font-size: 12px;">Avg</span> <span class="legend-val" style="font-size: 12px;">${avg}</span>
                            <span style="color: #666; font-size: 12px;">Val</span> <span class="legend-val" style="font-size: 12px;">${val}</span>
                            <span style="color: #666; font-size: 12px;">Freq</span> <span class="legend-val" style="font-size: 12px;">${freq}</span>
                            <span style="color: #666; font-size: 12px;">Chg</span> <span class="legend-val" style="font-size: 12px; color: ${chgColor}">${chg} (${pct}%)</span>
                            <br>
                            <span style="color: #666; font-size: 12px;">F.Buy</span> <span class="legend-val" style="font-size: 12px;">${fBuy}</span>
                            <span style="color: #666; font-size: 12px;">F.Sell</span> <span class="legend-val" style="font-size: 12px;">${fSell}</span>
                            <span style="color: #666; font-size: 12px;">Net.F</span> <span class="legend-val" style="font-size: 12px; color: ${netFColor}">${netF}</span>
                        `;
                    }"""

content = re.sub(r'                    if \(fullBar\.volume !== undefined\) \{\n.*?\`;\n                    \} else if \(fullBar\.levels\) \{\n.*?totalVolume = fullBar\.levels\.reduce.*?\n                    \}', replacement, content, flags=re.DOTALL)
with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)

