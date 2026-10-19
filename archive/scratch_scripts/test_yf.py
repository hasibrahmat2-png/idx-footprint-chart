import yfinance as yf
data = yf.download(["BBCA.JK", "GOTO.JK"], period="2d", group_by="ticker", progress=False)
try:
    print("Trying data['BBCA.JK']['Close']:")
    print(data["BBCA.JK"]["Close"])
except Exception as e:
    print(e)
    
try:
    print("Trying data['Close']['BBCA.JK']:")
    print(data["Close"]["BBCA.JK"])
except Exception as e:
    print(e)
