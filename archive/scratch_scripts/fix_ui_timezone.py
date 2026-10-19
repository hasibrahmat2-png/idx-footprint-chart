with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

target = """                        data.forEach(d => {
                            if (typeof d.time === 'string') {
                                d.time = Math.floor(new Date(d.time).getTime() / 1000);
                            }
                        });"""

replacement = """                        data.forEach(d => {
                            if (typeof d.time === 'string') {
                                d.time = Math.floor(new Date(d.time).getTime() / 1000);
                            }
                        });
                        
                        // ABSOLUTE MATHEMATICAL FIX FOR ALL TIMEZONES (EGYPT/LONDON/JAKARTA/ETC)
                        // This forces the True UTC timestamp to display exactly as WIB in the user's local browser timezone
                        if (tf !== '1d') {
                            const jakartaOffsetMins = 7 * 60; // WIB is UTC+7
                            const localOffsetMins = new Date().getTimezoneOffset(); // e.g. -180 in Egypt, 0 in London, -420 in Jakarta
                            const shiftSeconds = (jakartaOffsetMins + localOffsetMins) * 60;
                            data.forEach(d => {
                                d.time += shiftSeconds;
                            });
                        }"""

content = content.replace(target, replacement)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)
