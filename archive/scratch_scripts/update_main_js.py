with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

# 1. Update footprint default
content = content.replace("let footprintVisible = true;", "let footprintVisible = false;")
content = content.replace("visible: false // Hidden initially", "visible: true // Visible initially")

# 2. Update MA and Median defaults
content = content.replace("let maVisible = true;", "let maVisible = false;")
content = content.replace("let medianVisible = true;", "let medianVisible = false;")
content = content.replace("title: 'SMA (20)',\n                visible: true", "title: 'SMA (20)',\n                visible: false")
content = content.replace("title: 'Median Price',\n                visible: true", "title: 'Median Price',\n                visible: false")

# 3. Add change event listener and local storage save
target_ticker = """            // Listen for user pressing Enter in the ticker input
            document.getElementById('ticker-input').addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    loadTimeframe(currentActiveTf);
                }
            });"""

replacement_ticker = """            // Listen for user pressing Enter in the ticker input
            const tickerInput = document.getElementById('ticker-input');
            tickerInput.addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    loadTimeframe(currentActiveTf);
                }
            });
            // Listen for change events (triggered when clicking a row in the screener)
            tickerInput.addEventListener('change', function () {
                loadTimeframe(currentActiveTf);
            });"""
content = content.replace(target_ticker, replacement_ticker)

# 4. Save to localStorage inside loadTimeframe
target_load = """            function loadTimeframe(tf) {
                currentActiveTf = tf;
                const ticker = document.getElementById('ticker-input').value.toUpperCase();"""

replacement_load = """            function loadTimeframe(tf) {
                currentActiveTf = tf;
                const tickerInput = document.getElementById('ticker-input');
                const ticker = tickerInput.value.toUpperCase();
                localStorage.setItem('lastTicker', ticker);"""
content = content.replace(target_load, replacement_load)

# 5. Load from localStorage on initialization
target_init = """            // Load initial
            loadTimeframe('5m');"""

replacement_init = """            // Load initial ticker from localStorage
            const savedTicker = localStorage.getItem('lastTicker');
            if (savedTicker) {
                document.getElementById('ticker-input').value = savedTicker;
            }
            loadTimeframe('5m');"""
content = content.replace(target_init, replacement_init)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)
