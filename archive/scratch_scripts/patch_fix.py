with open('my-footprint-demo.html', 'r') as f:
    content = f.read()

missing_code = """
        const sidebar = document.getElementById('sidebar');
        const screenerTbody = document.getElementById('screener-tbody');
        
        document.getElementById('screener-btn').addEventListener('click', () => {
            if(sidebar.style.display === 'flex') {
                sidebar.style.display = 'none';
            } else {
                sidebar.style.display = 'flex';
                if(screenerData.length === 0) loadScreenerData();
            }
        });
"""

content = content.replace("let sortKey = 'change_percentage';", missing_code + "\n        let sortKey = 'change_percentage';")

with open('my-footprint-demo.html', 'w') as f:
    f.write(content)
