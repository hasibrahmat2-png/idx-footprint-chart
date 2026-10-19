"""
live_trade_bridge.py - Real-Time IDX Running Trades Upstream Bridge (Python)

Connects to upstream WebSocket (wss://stock.arjum.com/ws/running-trade)
with the required authentication headers (X-API-Key), and re-broadcasts
live trades to local browser clients on ws://localhost:8765.
"""

import os
import sys
import asyncio
import json
from pathlib import Path

# Auto-load .env
env_file = Path(".env")
if env_file.exists():
    with open(env_file, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k not in os.environ:
                    os.environ[k] = v

import re
import urllib.request

UPSTREAM_URL = os.environ.get("UPSTREAM_WS_URL", "wss://stock.arjum.com/ws/running-trade")
API_KEY = os.environ.get("STOCK_API_KEY", "") or os.environ.get("IDX_API_KEY", "")
LOCAL_PORT = int(os.environ.get("LOCAL_WS_PORT", "8765"))

def save_env_config(new_entries: dict):
    try:
        content = ""
        if env_file.exists():
            with open(env_file, "r") as f:
                content = f.read()
        for k, v in new_entries.items():
            if v is None:
                continue
            os.environ[k] = str(v)
            pattern = re.compile(rf"^{k}=.*$", re.MULTILINE)
            if pattern.search(content):
                content = pattern.sub(f"{k}={v}", content)
            else:
                content = content.strip() + f"\n{k}={v}\n"
        with open(env_file, "w") as f:
            f.write(content.strip() + "\n")
        print(f"[Bridge] Saved configuration to {env_file}")
    except Exception as e:
        print(f"[Bridge] Error saving config to .env: {e}")

def save_env_key(key: str):
    save_env_config({"STOCK_API_KEY": key})

def get_alert_config():
    discord_url = os.environ.get("DISCORD_WEBHOOK_URL", "")
    telegram_token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID", "")
    return {
        "type": "alert_config",
        "discordConfigured": bool(discord_url),
        "discordWebhookUrl": discord_url,
        "discordWebhookMasked": f"{discord_url[:35]}••••••••" if discord_url else "",
        "discordEnabled": os.environ.get("DISCORD_ALERT_ENABLED", "true").lower() != "false",
        "telegramConfigured": bool(telegram_token and telegram_chat_id),
        "telegramToken": telegram_token,
        "telegramBotToken": telegram_token,
        "telegramTokenMasked": f"{telegram_token[:8]}••••••••" if telegram_token else "",
        "telegramChatId": telegram_chat_id,
        "telegramEnabled": os.environ.get("TELEGRAM_ALERT_ENABLED", "true").lower() != "false",
        "cooldownMinutes": int(os.environ.get("ALERT_COOLDOWN_MINUTES", "5"))
    }

TIER_COLORS = {
    1: 0x00C853,
    2: 0x2962FF,
    3: 0xFFB300,
    "broken": 0xD50000
}

def send_discord_alert(payload: dict, is_test: bool = False):
    webhook_url = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook_url:
        return {"success": False, "error": "DISCORD_WEBHOOK_URL not configured"}
    
    now_str = datetime.datetime.now().strftime("%H:%M:%S") + " WIB"
    if is_test:
        body = {
            "username": "IDX Footprint Alerts (Python Bridge)",
            "avatar_url": "https://stockbit.com/favicon.ico",
            "embeds": [{
                "title": "🔔 [TEST ALERT] Discord Alert Stream Connected!",
                "description": "Test notification from **IDX Footprint Chart & Follow Through Alert System (Python Bridge)**.\nYour Discord webhook is configured and operating correctly.",
                "color": 0x2962FF,
                "fields": [
                    {"name": "Channel Status", "value": "✅ Online & Listening", "inline": True},
                    {"name": "Timestamp", "value": now_str, "inline": True}
                ],
                "footer": {"text": "IDX Footprint Chart • Python Bridge"},
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }]
        }
    else:
        st = payload.get("status", "testing")
        tier = payload.get("priorityTier", 1)
        color = TIER_COLORS.get("broken" if st == "broken" else tier, 0x2962FF)
        status_icon = "🎯" if st == "testing" else ("⚠️" if st == "broken" else "🛡️")
        status_label = "TESTING SUPPORT NOW" if st == "testing" else ("SUPPORT BROKEN" if st == "broken" else "HOLDING ABOVE SUPPORT")
        
        price = payload.get("price", 0)
        chg = payload.get("changePercent", 0)
        chg_sign = "+" if chg >= 0 else ""
        price_formatted = f"Rp {price:,.0f} ({chg_sign}{chg:.2f}%)"
        
        support_desc = payload.get("supportLabel", "Support Level")
        if payload.get("isZone") and payload.get("zoneBottom") and payload.get("zoneTop"):
            support_desc = f"Demand Zone [{payload.get('zoneBottom')} - {payload.get('zoneTop')}]"
            
        dt = payload.get("distanceTicks", 0)
        dt_sign = "+" if dt >= 0 else ""
        dp = payload.get("distancePercent", 0)
        dp_sign = "+" if dp >= 0 else ""
        dist_desc = f"{dt_sign}{dt} ticks ({dp_sign}{dp:.1f}%)"

        def format_movement_entry_discord(entry, fallback):
            if not entry or not entry.get("time"):
                return fallback
            chg = entry.get("changePercent", 0)
            chg_sign = "+" if chg >= 0 else ""
            st = entry.get("status", "")
            st_text = f" ({st})" if st else ""
            return f"`{entry.get('time')}` • Rp {entry.get('price', 0):,.0f} ({chg_sign}{chg:.2f}%) • {entry.get('label', 'Support')}{st_text}"

        first_entry_str = format_movement_entry_discord(payload.get("firstTouch"), "Belum ada sentuhan hari ini")
        prev_entry_str = format_movement_entry_discord(payload.get("prevAlert"), "None (Initial Touch Today)")
        curr_entry_str = format_movement_entry_discord(payload.get("currentAlert"), f"`{payload.get('time', now_str)}` • {price_formatted} • {support_desc} ({payload.get('status')})")
        movement_log_val = f"1️⃣ **First:** {first_entry_str}\n2️⃣ **Prev:** {prev_entry_str}\n3️⃣ **Now:** {curr_entry_str}"

        body = {
            "username": "IDX Footprint Alerts",
            "avatar_url": "https://stockbit.com/favicon.ico",
            "embeds": [{
                "title": f"{status_icon} [{payload.get('symbol')}] {status_label}",
                "description": f"Follow Through stock **${payload.get('symbol')}** is interacting with **{support_desc}**.",
                "color": color,
                "fields": [
                    {"name": "🏷️ Current Price", "value": price_formatted, "inline": True},
                    {"name": "🛡️ Primary Support", "value": f"Tier {tier}: {support_desc}", "inline": True},
                    {"name": "📏 Distance", "value": dist_desc, "inline": True},
                    {"name": "📈 Ghost ARA / ARB", "value": f"ARA: Rp {payload.get('araPrice', 0):,.0f} | ARB: Rp {payload.get('arbPrice', 0):,.0f}", "inline": False},
                    {"name": "📋 Movement Log (Hari Ini)", "value": movement_log_val, "inline": False},
                    {"name": "🕒 Waktu", "value": payload.get("time", now_str), "inline": True}
                ],
                "footer": {"text": "IDX Footprint Chart • Follow Through Stream"},
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
            }]
        }
        
    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "IDX-Alert-Bridge"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status in (200, 204):
            return {"success": True}
        raise RuntimeError(f"Discord returned HTTP {resp.status}")

def format_movement_entry_telegram(entry, fallback):
    if not entry or not entry.get("time"):
        return f"<i>{fallback}</i>"
    chg = entry.get("changePercent", 0)
    chg_sign = "+" if chg >= 0 else ""
    st = entry.get("status", "")
    st_text = f" [{html_escape(st.upper())}]" if st else ""
    lbl = html_escape(entry.get("label", "Support"))
    return f"<code>{html_escape(entry.get('time'))}</code> • Rp {entry.get('price', 0):,.0f} (<code>{chg_sign}{chg:.2f}%</code>) • {lbl}{st_text}"

def html_escape(val):
    if not val:
        return ""
    return str(val).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def send_telegram_alert(payload: dict, is_test: bool = False):
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    chat_id = os.environ.get("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return {"success": False, "error": "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured"}
        
    now_str = datetime.datetime.now().strftime("%H:%M:%S") + " WIB"
    if is_test:
        text = (
            f"🔔 <b>[TEST ALERT] Telegram Alert Stream Connected!</b>\n\n"
            f"Test notification from <b>IDX Footprint Chart & Follow Through Alert System (Python Bridge)</b>.\n"
            f"Status: ✅ Online & Operating Correctly\n"
            f"🕒 Waktu: <code>{now_str}</code>"
        )
    else:
        st = payload.get("status", "testing")
        tier = payload.get("priorityTier", 1)
        status_icon = "🎯" if st == "testing" else ("⚠️" if st == "broken" else "🛡️")
        status_label = "TESTING SUPPORT NOW" if st == "testing" else ("SUPPORT BROKEN" if st == "broken" else "HOLDING ABOVE SUPPORT")
        
        price = payload.get("price", 0)
        chg = payload.get("changePercent", 0)
        chg_sign = "+" if chg >= 0 else ""
        price_str = f"Rp {price:,.0f} (<code>{chg_sign}{chg:.2f}%</code>)"
        
        support_desc = payload.get("supportLabel", "Support Level")
        if payload.get("isZone") and payload.get("zoneBottom") and payload.get("zoneTop"):
            support_desc = f"Demand Zone [{payload.get('zoneBottom')} - {payload.get('zoneTop')}]"
            
        dt = payload.get("distanceTicks", 0)
        dt_sign = "+" if dt >= 0 else ""
        dp = payload.get("distancePercent", 0)
        dp_sign = "+" if dp >= 0 else ""
        dist_str = f"{dt_sign}{dt} ticks ({dp_sign}{dp:.1f}%)"
        ghost_str = f"ARA: Rp {payload.get('araPrice', 0):,.0f} | ARB: Rp {payload.get('arbPrice', 0):,.0f}"

        first_tg_str = format_movement_entry_telegram(payload.get("firstTouch"), "Belum ada sentuhan hari ini")
        prev_tg_str = format_movement_entry_telegram(payload.get("prevAlert"), "None (Initial Touch Today)")
        curr_tg_str = format_movement_entry_telegram(payload.get("currentAlert"), f"{payload.get('time', now_str)} • {price_str} • {html_escape(support_desc)} [{(st or '').upper()}]")

        text = (
            f"{status_icon} <b>FOLLOW THROUGH ALERT: ${payload.get('symbol')}</b>\n\n"
            f"⚡ <b>Status:</b> <code>{status_label}</code>\n"
            f"🏷️ <b>Harga:</b> {price_str}\n"
            f"🛡️ <b>Level:</b> Priority {tier} ({html_escape(support_desc)})\n"
            f"📏 <b>Jarak:</b> <code>{dist_str}</code>\n"
            f"📈 <b>Ghost Limits:</b> {ghost_str}\n"
            f"🕒 <b>Waktu:</b> {payload.get('time', now_str)}\n\n"
            f"📋 <b>Movement Log (Hari Ini):</b>\n"
            f"1️⃣ <b>First:</b> {first_tg_str}\n"
            f"2️⃣ <b>Prev:</b> {prev_tg_str}\n"
            f"3️⃣ <b>Now:</b> {curr_tg_str}\n\n"
            f"#{payload.get('symbol')} #IDX #SupportAlert"
        )
        
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    body = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "User-Agent": "IDX-Alert-Bridge"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        resp_data = json.loads(resp.read().decode("utf-8"))
        if resp_data.get("ok"):
            return {"success": True}
        raise RuntimeError(f"Telegram API error: {resp_data.get('description')}")

async def main():
    try:
        import websockets
    except ImportError:
        print("[Bridge] 'websockets' library is not installed in Python.")
        print("Using the Node.js bridge instead: node live_trade_bridge.mjs")
        sys.exit(1)

    global API_KEY
    connected_clients = set()
    latest_snapshot = None
    latest_top5 = None

    # Load allowed IHSG stocks whitelist
    allowed_stocks = set()
    json_path = Path("indicator-examples/public/ihsg_stocks.json")
    if json_path.exists():
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                allowed_stocks = set(s.upper().strip() for s in json.load(f))
            print(f"[Bridge] Loaded {len(allowed_stocks)} allowed stocks from ihsg_stocks.json")
        except Exception as e:
            print(f"[Bridge] Warning loading ihsg_stocks.json: {e}")

    if not allowed_stocks:
        csv_path = Path("ihsg_list.csv")
        if csv_path.exists():
            try:
                INDEX_SET = {
                    'IHSG', 'LQ45', 'IDX30', 'IDX80', 'IDXSMC-COM', 'IDXSMC-LIQ', 'IDXHIDIV20', 'IDXBUMN20',
                    'IDXG30', 'IDXV30', 'IDXQ30', 'IDXESGL', 'IDXLQ45LCL', 'IDXMESBUMN', 'JII', 'JII70', 'ISSI',
                    'KOMPAS100', 'MNC36', 'INVESTOR33', 'BISNIS-27', 'PEFINDO25', 'I-GRADE', 'SMINFRA18',
                    'SRI-KEHATI', 'IDXPEFINDOPB', 'MBX', 'DBX', 'IDXENERGY', 'IDXBASIC', 'IDXINDUST', 'IDXCYCLIC',
                    'IDXNONCYC', 'IDXHEALTH', 'IDXFINANCE', 'IDXPROPERT', 'IDXTECHNO', 'IDXINFRA', 'IDXTRANS', 'SYMBOL'
                }
                with open(csv_path, "r", encoding="utf-8") as f:
                    for line in f:
                        s = line.strip().upper()
                        if not s or s in INDEX_SET or "-" in s or len(s) > 5:
                            continue
                        allowed_stocks.add(s)
                print(f"[Bridge] Loaded {len(allowed_stocks)} allowed stocks from ihsg_list.csv")
            except Exception as e:
                print(f"[Bridge] Warning loading ihsg_list.csv: {e}")

    def get_status_payload():
        return {
            "type": "bridge_status",
            "connected": True,
            "upstreamUrl": UPSTREAM_URL,
            "hasKey": bool(API_KEY),
            "apiKeyMasked": f"{API_KEY[:10]}••••••••" if API_KEY else "",
            "allowedStocksCount": len(allowed_stocks),
            "alertConfig": get_alert_config()
        }

    async def client_handler(websocket):
        nonlocal latest_snapshot, latest_top5
        connected_clients.add(websocket)
        print(f"[Bridge] Local client connected (Total: {len(connected_clients)})")
        try:
            await websocket.send(json.dumps(get_status_payload()))
            if latest_snapshot:
                await websocket.send(latest_snapshot)
            if latest_top5:
                await websocket.send(latest_top5)

            async for message in websocket:
                try:
                    data = json.loads(message)
                    action = data.get("action")
                    if action == "set_api_key" and data.get("apiKey"):
                        global API_KEY
                        API_KEY = data["apiKey"].strip()
                        save_env_key(API_KEY)
                    elif action == "get_status":
                        await websocket.send(json.dumps(get_status_payload()))
                    elif action == "get_alert_config":
                        await websocket.send(json.dumps(get_alert_config()))
                    elif action == "set_alert_config":
                        updates = {}
                        if "discordWebhookUrl" in data:
                            updates["DISCORD_WEBHOOK_URL"] = data["discordWebhookUrl"].strip()
                        if "discordEnabled" in data:
                            updates["DISCORD_ALERT_ENABLED"] = "true" if data["discordEnabled"] else "false"
                        token = data.get("telegramToken") or data.get("telegramBotToken")
                        if token is not None:
                            updates["TELEGRAM_BOT_TOKEN"] = token.strip()
                        if "telegramChatId" in data:
                            updates["TELEGRAM_CHAT_ID"] = data["telegramChatId"].strip()
                        if "telegramEnabled" in data:
                            updates["TELEGRAM_ALERT_ENABLED"] = "true" if data["telegramEnabled"] else "false"
                        if "cooldownMinutes" in data:
                            updates["ALERT_COOLDOWN_MINUTES"] = str(data["cooldownMinutes"])
                        save_env_config(updates)
                        cfg = get_alert_config()
                        await websocket.send(json.dumps({"type": "alert_config_saved", "success": True, "config": cfg}))
                    elif action == "test_alert":
                        channel = data.get("channel", "all")
                        discord_ok, discord_err = False, None
                        telegram_ok, telegram_err = False, None
                        if channel in ("discord", "all"):
                            try:
                                res = send_discord_alert({}, is_test=True)
                                discord_ok = res.get("success", False)
                                if not discord_ok:
                                    discord_err = res.get("error")
                            except Exception as e:
                                discord_err = str(e)
                        if channel in ("telegram", "all"):
                            try:
                                res = send_telegram_alert({}, is_test=True)
                                telegram_ok = res.get("success", False)
                                if not telegram_ok:
                                    telegram_err = res.get("error")
                            except Exception as e:
                                telegram_err = str(e)
                        await websocket.send(json.dumps({
                            "type": "alert_test_result",
                            "channel": channel,
                            "discord": {"success": discord_ok, "error": discord_err},
                            "telegram": {"success": telegram_ok, "error": telegram_err}
                        }))
                    elif action == "dispatch_alert" and data.get("payload"):
                        payload = data["payload"]
                        discord_sent, discord_err = False, None
                        telegram_sent, telegram_err = False, None
                        if os.environ.get("DISCORD_ALERT_ENABLED", "true").lower() != "false" and os.environ.get("DISCORD_WEBHOOK_URL"):
                            try:
                                send_discord_alert(payload, is_test=False)
                                discord_sent = True
                            except Exception as e:
                                discord_err = str(e)
                        if os.environ.get("TELEGRAM_ALERT_ENABLED", "true").lower() != "false" and os.environ.get("TELEGRAM_BOT_TOKEN") and os.environ.get("TELEGRAM_CHAT_ID"):
                            try:
                                send_telegram_alert(payload, is_test=False)
                                telegram_sent = True
                            except Exception as e:
                                telegram_err = str(e)
                        await websocket.send(json.dumps({
                            "type": "alert_dispatch_result",
                            "symbol": payload.get("symbol"),
                            "discord": {"sent": discord_sent, "error": discord_err},
                            "telegram": {"sent": telegram_sent, "error": telegram_err}
                        }))
                except Exception as e:
                    pass
        finally:
            connected_clients.remove(websocket)
            print(f"[Bridge] Local client disconnected (Remaining: {len(connected_clients)})")

    async def forward_upstream():
        nonlocal latest_snapshot, latest_top5
        headers = {}
        if API_KEY:
            headers["X-API-Key"] = API_KEY

        while True:
            try:
                print(f"[Bridge] Connecting to upstream {UPSTREAM_URL}...")
                async with websockets.connect(
                    UPSTREAM_URL,
                    extra_headers=headers,
                    ping_interval=20,
                    ping_timeout=10,
                    close_timeout=5
                ) as upstream:
                    print("[Bridge] Upstream connected! Forwarding live trades with keep-alive heartbeat.")
                    async for message in upstream:
                        to_broadcast = message
                        try:
                            parsed = json.loads(message)
                            msg_type = parsed.get("type")
                            if msg_type == "snapshot":
                                if isinstance(parsed.get("top"), list) and allowed_stocks:
                                    parsed["top"] = [
                                        tp for tp in parsed["top"]
                                        if (tp.get("ticker") or tp.get("symbol") or "").upper() in allowed_stocks
                                    ]
                                if isinstance(parsed.get("recent"), list) and allowed_stocks:
                                    parsed["recent"] = [
                                        rc for rc in parsed["recent"]
                                        if (rc.get("t") or rc.get("symbol") or rc.get("code") or "").upper() in allowed_stocks
                                    ]
                                to_broadcast = json.dumps(parsed)
                                latest_snapshot = to_broadcast
                            elif msg_type == "top5":
                                if isinstance(parsed.get("top"), list) and allowed_stocks:
                                    parsed["top"] = [
                                        tp for tp in parsed["top"]
                                        if (tp.get("ticker") or tp.get("symbol") or "").upper() in allowed_stocks
                                    ]
                                to_broadcast = json.dumps(parsed)
                                latest_top5 = to_broadcast
                            elif msg_type == "trade" and parsed.get("data"):
                                sym = (parsed["data"].get("t") or parsed["data"].get("symbol") or parsed["data"].get("code") or "").upper()
                                if allowed_stocks and sym not in allowed_stocks:
                                    continue
                            elif parsed.get("symbol") or parsed.get("t") or parsed.get("code"):
                                sym = (parsed.get("symbol") or parsed.get("t") or parsed.get("code") or "").upper()
                                if allowed_stocks and sym not in allowed_stocks:
                                    continue
                            elif isinstance(parsed, list) and allowed_stocks:
                                filtered = [
                                    item for item in parsed
                                    if (item.get("t") or item.get("symbol") or item.get("code") or "").upper() in allowed_stocks
                                ]
                                if not filtered:
                                    continue
                                to_broadcast = json.dumps(filtered)
                        except Exception:
                            pass

                        if connected_clients:
                            await asyncio.gather(
                                *[client.send(to_broadcast) for client in connected_clients],
                                return_exceptions=True
                            )
            except Exception as e:
                print(f"[Bridge] Upstream error: {e}. Retrying in 5s...")
                await asyncio.sleep(5)

    async def heartbeat_loop():
        start_time = asyncio.get_event_loop().time()
        while True:
            await asyncio.sleep(10)
            if connected_clients:
                hb = json.dumps({
                    "type": "bridge_heartbeat",
                    "uptimeSec": int(asyncio.get_event_loop().time() - start_time),
                    "upstreamConnected": True,
                    "upstreamStatus": "connected",
                    "clientCount": len(connected_clients)
                })
                await asyncio.gather(
                    *[client.send(hb) for client in connected_clients],
                    return_exceptions=True
                )

    server = await websockets.serve(client_handler, "localhost", LOCAL_PORT)
    print(f"[Bridge] WebSocket Server listening on ws://localhost:{LOCAL_PORT}")
    asyncio.create_task(heartbeat_loop())
    await forward_upstream()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[Bridge] Stopped.")

