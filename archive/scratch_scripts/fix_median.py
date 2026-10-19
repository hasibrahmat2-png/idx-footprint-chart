with open('indicator-examples/src/my-footprint-ts/main.ts', 'r') as f:
    content = f.read()

content = content.replace(
    "const medianData = calculateMedianPriceIndicatorValues(currentChartData);",
    "const medianData = calculateMedianPriceIndicatorValues(currentChartData, { offset: 0 });"
)

with open('indicator-examples/src/my-footprint-ts/main.ts', 'w') as f:
    f.write(content)
