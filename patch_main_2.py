import re

with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

# Fix setupTag and P1/P2/P3 text
content = content.replace(
    """const setupTag = item.primarySupport.isZone 
                ? `Zone ${formatTerminalPrice(item.primarySupport.price, isFx)}` 
                : `Sup ${formatTerminalPrice(item.primarySupport.price, isFx)}`;""",
    """const setupTag = item.primarySupport.isZone && item.primarySupport.zoneBottom && item.primarySupport.zoneTop
                ? `Zone ${formatTerminalPrice(item.primarySupport.zoneBottom, isFx)} - ${formatTerminalPrice(item.primarySupport.zoneTop, isFx)}` 
                : `Sup ${formatTerminalPrice(item.primarySupport.price, isFx)}`;"""
)

content = content.replace(
    """<span style="font-size: 10px; color: #8f95a0;">P${item.priorityTier} - ${setupTag}</span>""",
    """<span style="font-size: 10px; color: #8f95a0;">${setupTag}</span>"""
)

# Set Alerts as default expanded tab
content = content.replace(
    """startLiveUiLoop();""",
    """startLiveUiLoop();
                setTimeout(() => {
                    openDrawer('alerts');
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar) {
                        sidebar.classList.add('expanded');
                        updateExpandButtons(true);
                    }
                }, 100);"""
)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)

print("Patch 2 applied")
