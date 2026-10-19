with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

target = """                            if (footprintVisible) {
                                footprintSeries.applyOptions({ visible: true });
                                nativeCandles.applyOptions({ visible: false });
                            }
                        } else {"""

replacement = """                            if (footprintVisible) {
                                footprintSeries.applyOptions({ visible: true });
                                nativeCandles.applyOptions({ visible: false });
                            } else {
                                footprintSeries.applyOptions({ visible: false });
                                nativeCandles.applyOptions({ visible: true });
                            }
                        } else {"""

content = content.replace(target, replacement)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)
