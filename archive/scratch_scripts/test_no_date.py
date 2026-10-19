import urllib.request, json
url_no_date = 'https://exodus.stockbit.com/order-trade/running-trade?symbols%5B%5D=KAQI&sort=ASC&limit=80&order_by=RUNNING_TRADE_ORDER_BY_TIME&trade_number=420667'
url_no_date_611537 = 'https://exodus.stockbit.com/order-trade/running-trade?symbols%5B%5D=KAQI&sort=ASC&limit=80&order_by=RUNNING_TRADE_ORDER_BY_TIME&trade_number=611537'

headers = {
    'Accept': 'application/json',
    'Authorization': 'Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6ImExNWQ5OGE2LTdkYzgtNDM3NS05NDk0LTEyOWJlM2RlODVkNCIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InVzZSI6Ikhhc2liUmFobWF0IiwiZW1hIjoiaGFzaWJtYXVsYW5hcmFobWF0QGdtYWlsLmNvbSIsImZ1bCI6IkFzYURlbiIsInNlcyI6ImZkRWFhS1ROOWpDb3N2V0IiLCJkdmMiOiI0ZjY5Yzk2MDg2YWU4YWNiODU3MWQxM2I2YjY4OTBiNiIsInVpZCI6NTg2MjkzMSwiY291IjoiRUcifSwiZXhwIjoxNzg4Mzg5NjA1LCJpYXQiOjE3ODgzMDMyMDUsImlzcyI6IlNUT0NLQklUIiwianRpIjoiNTEzNDJiMzAtZjUwMS00MDA5LWIyNjctMzMyYTUzZTNmODYwIiwibmJmIjoxNzg4MzAzMjA1LCJ2ZXIiOiJ2MSJ9.T7UQry2Wq9hPLWN5KbEshleeD-atPkKf4p0dUU7qZdtBtkemYnq9wVVdN9YHZrqrR54bgq3Ync6hUJfzOPh-WBDSdjoIs1w6mEa0yivnDBe8djrFzIKaF-rXAI_05V2J2nivaVKDMqIWqDBD0IT8pVll44wD6ln9JL-ynYRcaqJs_CwCfQUqBrPDZlb8UbZFlsFXEZg32Paqy6CDVevdGnuvoR2H0lyZ1sCEre4a_oSd2LsCH59E_DYZVQ0DGohcY4AGA-LmZGaBldkl_aMBJiNlexfr2pc1_ZHj5oBtJ_QK01w50lsRUTnD2WkB_cz4YZTrORxLGG4UbTKtJI-Sew',
    'Origin': 'https://stockbit.com',
    'Referer': 'https://stockbit.com/',
    'User-Agent': 'Mozilla/5.0'
}

for u in [url_no_date, url_no_date_611537]:
    req = urllib.request.Request(u, headers=headers)
    try:
        with urllib.request.urlopen(req) as response:
            res = json.loads(response.read().decode('utf-8'))
            print('URL:', u)
            print('Count:', len(res['data'].get('running_trade', [])))
            if res['data'].get('running_trade'):
                print('First time:', res['data']['running_trade'][0]['time'])
                print('Last time:', res['data']['running_trade'][-1]['time'])
    except Exception as e:
        print('Error:', e)
