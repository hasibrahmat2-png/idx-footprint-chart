import { resolve } from 'path';
import { defineConfig } from 'vite';
import { globby } from 'globby';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocket } from 'ws';

const paths = (await globby(['./src/**/*.html'])).map(path =>
	path.replace('./src/', '')
);

const input = {
	main: resolve(__dirname, '../index.html'),
};

let count = 0;
paths.forEach(p => {
	input[count++] = resolve(__dirname, p);
});

const ENV_PATH = resolve(__dirname, '../../.env');
const WIB_OFFSET_SEC = 7 * 3600; // 25200 seconds (UTC+7)

function readExnessEnv() {
	let token = process.env.EXNESS_TOKEN || '';
	let exServer = process.env.EXNESS_SERVER || 'real20';
	let account = process.env.EXNESS_ACCOUNT || '159936924';
	let host = process.env.EXNESS_HOST || 'rtapi-sg.useusecapwaskeyyepjamlaw.com';

	if (fs.existsSync(ENV_PATH)) {
		try {
			const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
			for (const rawLine of lines) {
				const l = rawLine.trim();
				if (l.startsWith('EXNESS_TOKEN=')) token = l.slice(13).trim().replace(/^['"]|['"]$/g, '');
				if (l.startsWith('EXNESS_SERVER=')) exServer = l.slice(14).trim().replace(/^['"]|['"]$/g, '');
				if (l.startsWith('EXNESS_ACCOUNT=')) account = l.slice(15).trim().replace(/^['"]|['"]$/g, '');
				if (l.startsWith('EXNESS_HOST=')) host = l.slice(12).trim().replace(/^['"]|['"]$/g, '');
			}
		} catch (e) {}
	}

	token = cleanExnessToken(token);
	return { token, exServer, account, host };
}

function cleanExnessToken(raw) {
	if (!raw) return '';
	let t = String(raw).trim();
	t = t.replace(/^Sec-WebSocket-Protocol:\s*/i, '');
	t = t.replace(/^exness-ws-protocol\s*,\s*/i, '');
	t = t.replace(/^Authorization:\s*/i, '');
	t = t.replace(/^Bearer\s+/i, '');
	t = t.replace(/^['"]|['"]$/g, '').trim();
	return t;
}

function decodeJwtExp(token) {
	if (!token) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
		return typeof payload.exp === 'number' ? payload.exp : null;
	} catch (e) {
		return null;
	}
}

function saveExnessTokenToEnv(newToken) {
	const cleaned = cleanExnessToken(newToken);
	process.env.EXNESS_TOKEN = cleaned;
	let lines = [];
	let found = false;
	if (fs.existsSync(ENV_PATH)) {
		lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim().startsWith('EXNESS_TOKEN=')) {
				lines[i] = `EXNESS_TOKEN="${cleaned}"`;
				found = true;
			}
		}
	}
	if (!found) {
		lines.push(`EXNESS_TOKEN="${cleaned}"`);
	}
	fs.writeFileSync(ENV_PATH, lines.filter((l, idx, arr) => idx < arr.length - 1 || l !== '').join('\n') + '\n', 'utf8');
}

function decodeJwtPayload(token) {
	if (!token) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
	} catch (e) {
		return null;
	}
}

function readStockbitEnv() {
	let socialToken = process.env.STOCKBIT_TOKEN || '';
	let refreshToken = process.env.STOCKBIT_REFRESH_TOKEN || '';
	let secToken = process.env.STOCKBIT_SECURITIES_TOKEN || '';

	if (fs.existsSync(ENV_PATH)) {
		try {
			const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
			for (const rawLine of lines) {
				const l = rawLine.trim();
				if (l.startsWith('STOCKBIT_TOKEN=')) socialToken = l.slice(15).trim().replace(/^['"]|['"]$/g, '');
				if (l.startsWith('STOCKBIT_REFRESH_TOKEN=')) refreshToken = l.slice(23).trim().replace(/^['"]|['"]$/g, '');
				if (l.startsWith('STOCKBIT_SECURITIES_TOKEN=')) secToken = l.slice(26).trim().replace(/^['"]|['"]$/g, '');
			}
		} catch (e) {}
	}

	return {
		socialToken: cleanExnessToken(socialToken),
		refreshToken: cleanExnessToken(refreshToken),
		secToken: cleanExnessToken(secToken),
	};
}

function parseStockbitInput(rawInput) {
	const text = String(rawInput || '').trim();
	let socialToken = '';
	let refreshToken = '';
	let secToken = '';

	const mSocial = text.match(/sb_social_access_token=([^;\s"']+)/);
	const mRefresh = text.match(/sb_social_refresh_token=([^;\s"']+)/);
	const mSec = text.match(/sb_securities_access_token=([^;\s"']+)/);

	if (mSocial || mRefresh || mSec) {
		if (mSocial) socialToken = cleanExnessToken(decodeURIComponent(mSocial[1]));
		if (mRefresh) refreshToken = cleanExnessToken(decodeURIComponent(mRefresh[1]));
		if (mSec) secToken = cleanExnessToken(decodeURIComponent(mSec[1]));
		return { socialToken, refreshToken, secToken };
	}

	const cleaned = cleanExnessToken(text);
	const payload = decodeJwtPayload(cleaned);
	if (payload) {
		if (payload?.data?.act === 'ACCOUNT_TYPE_EQUITY' || payload?.aud === 'https://stockbit.com') {
			secToken = cleaned;
		} else if (payload?.data?.typ === 'refresh') {
			refreshToken = cleaned;
		} else {
			socialToken = cleaned;
		}
	} else if (cleaned) {
		socialToken = cleaned;
	}

	return { socialToken, refreshToken, secToken };
}

function saveStockbitTokensToEnv({ socialToken, refreshToken, secToken }) {
	const current = readStockbitEnv();
	const nextSocial = socialToken || current.socialToken;
	const nextRefresh = refreshToken || current.refreshToken;
	const nextSec = secToken || current.secToken;

	if (nextSocial) process.env.STOCKBIT_TOKEN = nextSocial;
	if (nextRefresh) process.env.STOCKBIT_REFRESH_TOKEN = nextRefresh;
	if (nextSec) process.env.STOCKBIT_SECURITIES_TOKEN = nextSec;

	let lines = [];
	if (fs.existsSync(ENV_PATH)) {
		lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
	}

	const upsertKey = (key, val) => {
		if (!val) return;
		let found = false;
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim().startsWith(`${key}=`)) {
				lines[i] = `${key}="${val}"`;
				found = true;
			}
		}
		if (!found) {
			lines.push(`${key}="${val}"`);
		}
	};

	upsertKey('STOCKBIT_TOKEN', nextSocial);
	upsertKey('STOCKBIT_REFRESH_TOKEN', nextRefresh);
	upsertKey('STOCKBIT_SECURITIES_TOKEN', nextSec);

	fs.writeFileSync(ENV_PATH, lines.filter((l, idx, arr) => idx < arr.length - 1 || l !== '').join('\n') + '\n', 'utf8');
}

function parseStockbitHistoryDate(dateStr, timeStr) {
	// e.g. dateStr = "19 Oct 2026", timeStr = "08:58:00"
	const months = {
		jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
		jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
	};
	const parts = String(dateStr || '').trim().split(/\s+/);
	let ymd = '2026-01-01';
	if (parts.length === 3) {
		const dd = String(parts[0]).padStart(2, '0');
		const mm = months[String(parts[1]).toLowerCase().slice(0, 3)] || '01';
		const yyyy = parts[2];
		ymd = `${yyyy}-${mm}-${dd}`;
	}
	const hms = String(timeStr || '09:00:00').trim() || '09:00:00';
	const dtStr = `${ymd} ${hms}`;
	const fakeUtcSec = Math.floor(Date.parse(`${ymd}T${hms}Z`) / 1000) || 0;
	return { dateStr: ymd, datetimeStr: dtStr, fakeUtcSec };
}

function resolveExnessSymbol(rawSym, exServer) {
	const s = String(rawSym || 'XAUUSDc').trim();
	const upper = s.toUpperCase();
	const base = upper.replace(/[MC]$/i, '');
	if (base === 'XAUUSD') {
		return exServer.toLowerCase().startsWith('real') ? 'XAUUSDc' : 'XAUUSDm';
	}
	if (s.endsWith('M')) return s.slice(0, -1) + 'm';
	if (s.endsWith('C')) return s.slice(0, -1) + 'c';
	if (!s.endsWith('m') && !s.endsWith('c')) {
		return exServer.toLowerCase().startsWith('real') ? s + 'c' : s + 'm';
	}
	return s;
}

function parseTimeframeParam(tfRaw) {
	const s = String(tfRaw || '1').trim();
	if (s === '1m' || s === '1') return 1;
	if (s === '5m' || s === '5') return 5;
	if (s === '15m' || s === '15') return 15;
	if (s === '30m' || s === '30') return 30;
	if (s === '1h' || s === '60') return 60;
	if (s === '4h' || s === '240') return 240;
	if (s === '1d' || s === '1D' || s === '1440') return 1440;
	const n = parseInt(s, 10);
	return isNaN(n) || n <= 0 ? 1 : n;
}

function formatWibDateTime(utcSec) {
	const d = new Date((utcSec + WIB_OFFSET_SEC) * 1000);
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(d.getUTCDate()).padStart(2, '0');
	const hh = String(d.getUTCHours()).padStart(2, '0');
	const mi = String(d.getUTCMinutes()).padStart(2, '0');
	const ss = String(d.getUTCSeconds()).padStart(2, '0');
	return {
		dateStr: `${yyyy}-${mm}-${dd}`,
		datetimeStr: `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`,
		fakeUtcSec: Math.floor(Date.UTC(yyyy, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()) / 1000),
	};
}

export default defineConfig({
	base: './',
	plugins: [
		{
			name: 'exness-live-gateway',
			configureServer(server) {
				let upstreamWs = null;
				let upstreamConnected = false;
				let tokenValid = false;
				let lastError = null;
				let reconnectTimer = null;
				let activeToken = '';
				const sseClients = new Set();
				const lastTicks = new Map();
				const subscribedInstruments = new Set([
					'XAUUSDc', 'BTCUSDc', 'EURUSDc', 'USDJPYc', 'AUDUSDc', 'GBPUSDc'
				]);

				function getGatewayStatus() {
					const { token, exServer, account, host } = readExnessEnv();
					const exp = decodeJwtExp(token);
					const nowSec = Math.floor(Date.now() / 1000);
					const isExpired = exp ? exp <= nowSec : !token;
					const remainingSeconds = exp ? Math.max(0, exp - nowSec) : 0;
					const valid = Boolean(token && !isExpired && tokenValid);
					const masked = token ? `${token.slice(0, 14)}...${token.slice(-10)}` : '';
					return {
						ok: true,
						status: 'ok',
						connected: Boolean(upstreamConnected && valid),
						tokenValid: valid,
						hasToken: Boolean(token),
						isExpired,
						exp,
						remainingSeconds,
						account,
						server: exServer,
						host,
						error: isExpired ? 'Token Exness sudah kedaluwarsa (Expired)' : lastError,
						maskedToken: masked,
						tokenPreview: masked,
					};
				}

				function formatSseMessage(eventObj) {
					const evType = eventObj && eventObj.type ? eventObj.type : 'message';
					return `event: ${evType}\ndata: ${JSON.stringify(eventObj)}\n\n`;
				}

				function broadcastSse(eventObj) {
					const payload = formatSseMessage(eventObj);
					for (const res of sseClients) {
						try {
							res.write(payload);
						} catch (e) {
							sseClients.delete(res);
						}
					}
				}

				function broadcastStatus() {
					broadcastSse({
						type: 'exness_status',
						...getGatewayStatus(),
					});
				}

				function connectExnessUpstream(forceReconnect = false) {
					clearTimeout(reconnectTimer);
					const { token, exServer, account, host } = readExnessEnv();
					const exp = decodeJwtExp(token);
					const nowSec = Math.floor(Date.now() / 1000);

					if (!token || (exp && exp <= nowSec)) {
						tokenValid = false;
						upstreamConnected = false;
						lastError = !token ? 'Token Exness belum diisi' : 'Token Exness sudah kedaluwarsa';
						if (upstreamWs) {
							try { upstreamWs.close(); } catch (e) {}
							upstreamWs = null;
						}
						broadcastStatus();
						return;
					}

					if (!forceReconnect && upstreamWs && (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) && activeToken === token) {
						return;
					}

					if (upstreamWs) {
						try { upstreamWs.removeAllListeners(); upstreamWs.close(); } catch (e) {}
						upstreamWs = null;
					}

					activeToken = token;
					const wsUrl = `wss://${host}/rtapi/mt5/${exServer}/v2/ws/ticks/accounts/${account}`;

					try {
						const ws = new WebSocket(wsUrl, ['exness-ws-protocol', token], {
							headers: {
								'Origin': 'https://my.exness.com',
								'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
							},
						});
						upstreamWs = ws;

						ws.on('open', () => {
							upstreamConnected = true;
							tokenValid = true;
							lastError = null;
							// Subscribe each instrument individually so an unsupported symbol never rejects XAUUSDc
							for (const inst of subscribedInstruments) {
								ws.send(JSON.stringify({
									id: crypto.randomUUID(),
									subscribe: {
										event: 'ticks',
										instruments: [inst],
									},
								}));
							}
							broadcastStatus();
						});

						ws.on('message', (raw) => {
							try {
								const data = JSON.parse(raw.toString());
								if (data.code !== undefined && String(data.code) !== '200') {
									if (String(data.code) === '401' || String(data.code) === '403') {
										tokenValid = false;
										upstreamConnected = false;
										lastError = 'Token Exness ditolak (401 Unauthorized)';
										broadcastStatus();
										try { ws.close(); } catch (e) {}
									}
									return;
								}
								if (data.i && data.b !== undefined) {
									const sym = String(data.i);
									const bid = Number(data.b);
									const ask = Number(data.a ?? data.b);
									const timeMs = Number(data.t || Date.now());
									if (!isNaN(bid) && bid > 0) {
										const prev = lastTicks.get(sym);
										const direction = prev ? (bid > prev.bid ? 'BUY' : (bid < prev.bid ? 'SELL' : prev.direction)) : 'BUY';
										const tickEvent = {
											type: 'exness_tick',
											symbol: sym,
											bid,
											ask,
											price: bid,
											timeMs,
											direction,
										};
										lastTicks.set(sym, tickEvent);
										broadcastSse(tickEvent);
									}
								}
							} catch (e) {}
						});

						ws.on('unexpected-response', (_req, res) => {
							if (res.statusCode === 401 || res.statusCode === 403) {
								tokenValid = false;
								upstreamConnected = false;
								lastError = `Token Exness kedaluwarsa / tidak valid (HTTP ${res.statusCode})`;
								broadcastStatus();
							}
						});

						ws.on('error', (err) => {
							lastError = err.message;
						});

						ws.on('close', () => {
							upstreamConnected = false;
							broadcastStatus();
							const cur = readExnessEnv();
							const curExp = decodeJwtExp(cur.token);
							if (cur.token && (!curExp || curExp > Math.floor(Date.now() / 1000)) && tokenValid) {
								reconnectTimer = setTimeout(() => connectExnessUpstream(true), 3000);
							}
						});
					} catch (err) {
						upstreamConnected = false;
						lastError = err.message;
						broadcastStatus();
					}
				}

				// Start connection on server boot & periodic token expiry check
				connectExnessUpstream();
				const expiryCheckInterval = setInterval(() => {
					const { token } = readExnessEnv();
					const exp = decodeJwtExp(token);
					const nowSec = Math.floor(Date.now() / 1000);
					if (exp && exp <= nowSec && (tokenValid || upstreamConnected)) {
						tokenValid = false;
						upstreamConnected = false;
						lastError = 'Token Exness sudah kedaluwarsa';
						if (upstreamWs) {
							try { upstreamWs.close(); } catch (e) {}
							upstreamWs = null;
						}
						broadcastStatus();
					} else if (token && token !== activeToken) {
						// Automatically pick up external .env token updates too
						tokenValid = true;
						connectExnessUpstream(true);
					}
				}, 10000);

				server.httpServer?.on('close', () => {
					clearInterval(expiryCheckInterval);
					clearTimeout(reconnectTimer);
					if (upstreamWs) {
						try { upstreamWs.close(); } catch (e) {}
					}
				});

				// 1. SSE Live Stream Endpoint (/api/exness/stream)
				server.middlewares.use('/api/exness/stream', (req, res) => {
					res.writeHead(200, {
						'Content-Type': 'text/event-stream',
						'Cache-Control': 'no-cache, no-transform',
						'Connection': 'keep-alive',
						'X-Accel-Buffering': 'no',
					});

					sseClients.add(res);
					if (!upstreamConnected) {
						connectExnessUpstream();
					}

					// Send initial status and last known ticks immediately
					res.write(formatSseMessage({ type: 'exness_status', ...getGatewayStatus() }));
					for (const tick of lastTicks.values()) {
						res.write(formatSseMessage(tick));
					}

					const keepAlive = setInterval(() => {
						try {
							res.write(`: keepalive ${Date.now()}\n\n`);
						} catch (e) {
							clearInterval(keepAlive);
							sseClients.delete(res);
						}
					}, 15000);

					req.on('close', () => {
						clearInterval(keepAlive);
						sseClients.delete(res);
					});
				});

				// 2. Status Endpoint (/api/exness/status)
				server.middlewares.use('/api/exness/status', (_req, res) => {
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(getGatewayStatus()));
				});

				// 3. Token Update & Validation Endpoint (POST /api/exness/token)
				server.middlewares.use('/api/exness/token', (req, res) => {
					res.setHeader('Content-Type', 'application/json');
					if (req.method !== 'POST') {
						res.statusCode = 405;
						res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
						return;
					}
					let body = '';
					req.on('data', chunk => { body += chunk; });
					req.on('end', async () => {
						try {
							const parsed = JSON.parse(body || '{}');
							const cleaned = cleanExnessToken(parsed.token || '');
							if (!cleaned || cleaned.split('.').length !== 3) {
								res.statusCode = 400;
								res.end(JSON.stringify({ ok: false, error: 'Format JWT Token Exness tidak valid (harus 3 bagian dipisah titik).' }));
								return;
							}
							const exp = decodeJwtExp(cleaned);
							const nowSec = Math.floor(Date.now() / 1000);
							if (exp && exp <= nowSec) {
								tokenValid = false;
								upstreamConnected = false;
								broadcastStatus();
								res.statusCode = 401;
								res.end(JSON.stringify({ ok: false, error: 'Token tersebut sudah kedaluwarsa (Expired). Ambil token baru dari Exness Web Terminal.' }));
								return;
							}

							const { exServer, account, host } = readExnessEnv();
							const testUrl = `https://${host}/rtapi/mt5/${exServer}/v2/accounts/${account}/instruments/XAUUSDc/candles?time_frame=1&from=${Date.now()}&count=-1&price=bid`;
							const verifyRes = await fetch(testUrl, {
								headers: {
									'Authorization': `Bearer ${cleaned}`,
									'Origin': 'https://my.exness.com',
									'User-Agent': 'Mozilla/5.0',
								},
							});

							if (verifyRes.status === 401 || verifyRes.status === 403) {
								tokenValid = false;
								upstreamConnected = false;
								broadcastStatus();
								res.statusCode = 401;
								res.end(JSON.stringify({ ok: false, error: `Exness menolak token (HTTP ${verifyRes.status}). Pastikan token masih aktif.` }));
								return;
							}

							saveExnessTokenToEnv(cleaned);
							tokenValid = true;
							lastError = null;
							connectExnessUpstream(true);

							res.end(JSON.stringify({
								ok: true,
								...getGatewayStatus(),
								connected: true,
								tokenValid: true,
							}));
						} catch (err) {
							res.statusCode = 500;
							res.end(JSON.stringify({ ok: false, error: err.message }));
						}
					});
				});

				// 4. Authoritative Candles Endpoint (GET /api/exness/candles)
				server.middlewares.use('/api/exness/candles', async (req, res) => {
					res.setHeader('Content-Type', 'application/json');
					try {
						const urlObj = new URL(req.url || '', 'http://localhost');
						const { token, exServer, account, host } = readExnessEnv();
						if (!token) {
							res.statusCode = 401;
							res.end(JSON.stringify({ error: 'No EXNESS_TOKEN' }));
							return;
						}

						const exp = decodeJwtExp(token);
						if (exp && exp <= Math.floor(Date.now() / 1000)) {
							tokenValid = false;
							upstreamConnected = false;
							broadcastStatus();
							res.statusCode = 401;
							res.end(JSON.stringify({ error: 'EXNESS_TOKEN expired' }));
							return;
						}

						const rawSym = urlObj.searchParams.get('symbol') || 'XAUUSDc';
						const exSym = resolveExnessSymbol(rawSym, exServer);
						const tfNum = parseTimeframeParam(urlObj.searchParams.get('tf') || urlObj.searchParams.get('time_frame') || '1');
						const fromMs = urlObj.searchParams.get('from') || String(Date.now());
						const countParam = urlObj.searchParams.get('count') || '-200';
						const priceParam = urlObj.searchParams.get('price') || 'bid';

						if (!subscribedInstruments.has(exSym)) {
							subscribedInstruments.add(exSym);
							if (upstreamWs && upstreamWs.readyState === WebSocket.OPEN) {
								upstreamWs.send(JSON.stringify({
									id: crypto.randomUUID(),
									subscribe: { event: 'ticks', instruments: [exSym] },
								}));
							}
						}

						const apiUrl = `https://${host}/rtapi/mt5/${exServer}/v2/accounts/${account}/instruments/${encodeURIComponent(exSym)}/candles?time_frame=${tfNum}&from=${encodeURIComponent(fromMs)}&count=${encodeURIComponent(countParam)}&price=${encodeURIComponent(priceParam)}`;
						const r = await fetch(apiUrl, {
							headers: {
								'Authorization': `Bearer ${token}`,
								'Accept': 'application/json',
								'Origin': 'https://my.exness.com',
								'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
								'Cache-Control': 'no-cache',
							},
						});

						if (r.status === 401 || r.status === 403) {
							tokenValid = false;
							upstreamConnected = false;
							lastError = `Exness HTTP ${r.status}`;
							broadcastStatus();
							res.statusCode = r.status;
							res.end(JSON.stringify({ error: `Exness unauthorized (${r.status})` }));
							return;
						}

						if (!r.ok) {
							res.statusCode = r.status;
							res.end(JSON.stringify({ error: `Exness status ${r.status}` }));
							return;
						}

						tokenValid = true;
						const data = await r.json();
						const rawCandles = Array.isArray(data.price_history) ? data.price_history : [];

						const bars = rawCandles.map((c) => {
							const utcSec = Math.floor(Number(c.t) / 1000);
							// Intraday uses Fake-UTC WIB (utcSec + 7h), Daily (1440) uses UTC midnight
							const chartTime = tfNum >= 1440 ? utcSec : (utcSec + WIB_OFFSET_SEC);
							const o = Number(c.o);
							const h = Number(c.h);
							const l = Number(c.l);
							const cl = Number(c.c);
							const v = Number(c.v || 0);
							return {
								time: chartTime,
								utcTimeMs: Number(c.t),
								open: o,
								high: h,
								low: l,
								close: cl,
								volume: v,
							};
						});

						bars.sort((a, b) => a.time - b.time);

						res.end(JSON.stringify({
							ok: true,
							status: 'ok',
							symbol: exSym,
							tf: tfNum,
							count: bars.length,
							bars,
						}));

						// Non-blocking background sync into public/<symbol>_1m.json or _1d.json so static file is never stale or gapped on F5 refresh
						if (bars.length > 0 && (tfNum === 1 || tfNum === 1440)) {
							setImmediate(() => {
								try {
									const suffix = tfNum === 1440 ? '1d' : '1m';
									const jsonPath = resolve(__dirname, `../public/${exSym}_${suffix}.json`);
									if (!fs.existsSync(jsonPath)) return;
									const existingRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
									if (!Array.isArray(existingRaw) || existingRaw.length === 0) return;
									const minExistingTime = Number(existingRaw[0].time || 0);
									const mapByTime = new Map();
									const scanStart = Math.max(0, existingRaw.length - 10000);
									for (let i = scanStart; i < existingRaw.length; i++) {
										mapByTime.set(Number(existingRaw[i].time), i);
									}
									let changed = false;
									let insertedOutOfOrder = false;
									for (const b of bars) {
										const t = Number(b.time);
										if (!t || t < minExistingTime) continue;
										const idx = mapByTime.get(t);
										if (idx !== undefined) {
											const ex = existingRaw[idx];
											if (ex.open !== b.open || ex.high !== b.high || ex.low !== b.low || ex.close !== b.close || ex.volume !== b.volume) {
												ex.open = b.open;
												ex.high = b.high;
												ex.low = b.low;
												ex.close = b.close;
												ex.volume = b.volume;
												changed = true;
											}
										} else {
											const lastTime = Number(existingRaw[existingRaw.length - 1].time || 0);
											if (t < lastTime) {
												insertedOutOfOrder = true;
											}
											existingRaw.push({
												time: t,
												open: b.open,
												high: b.high,
												low: b.low,
												close: b.close,
												volume: b.volume,
											});
											mapByTime.set(t, existingRaw.length - 1);
											changed = true;
										}
									}
									if (insertedOutOfOrder) {
										existingRaw.sort((a, b) => Number(a.time) - Number(b.time));
									}
									if (changed) {
										fs.writeFileSync(jsonPath, JSON.stringify(existingRaw), 'utf8');
									}

									// Also keep SD Card CSV (data_intraday/<exSym>_intraday.csv) and Daily CSV (data/<exSym>.csv) 100% synced
									if (tfNum === 1) {
										const sdCsvPath = resolve(__dirname, `../../data_intraday/${exSym}_intraday.csv`);
										if (fs.existsSync(sdCsvPath)) {
											const stat = fs.statSync(sdCsvPath);
											const tailBytes = Math.min(stat.size, 512 * 1024); // Read only last 512KB (Chromebook RAM guardrail)
											const fd = fs.openSync(sdCsvPath, 'r+');
											try {
												const buf = Buffer.alloc(tailBytes);
												const readOffset = stat.size - tailBytes;
												fs.readSync(fd, buf, 0, tailBytes, readOffset);
												const tailStr = buf.toString('utf8');
												const firstNl = readOffset > 0 ? tailStr.indexOf('\n') : -1;
												const cleanStartOffset = readOffset + (firstNl >= 0 ? firstNl + 1 : 0);
												const cleanStr = firstNl >= 0 ? tailStr.slice(firstNl + 1) : tailStr;
												const lines = cleanStr.split(/\r?\n/).filter(Boolean);
												const rowMap = new Map();
												let minTailUtc = Infinity;
												for (const line of lines) {
													if (line.includes('unix_timestamp')) continue;
													const parts = line.split(',');
													const utcTs = Number(parts[1]);
													if (utcTs > 0) {
														if (utcTs < minTailUtc) minTailUtc = utcTs;
														rowMap.set(utcTs, line);
													}
												}
												let csvChanged = false;
												for (const b of bars) {
													const wibSec = Number(b.time);
													if (!wibSec) continue;
													const utcSec = wibSec - 25200;
													if (minTailUtc !== Infinity && utcSec < minTailUtc) continue;
													const dtStr = new Date(wibSec * 1000).toISOString().replace('T', ' ').slice(0, 19);
													const vol = Math.round(Number(b.volume || 0));
													const newLine = `${dtStr},${utcSec},${exSym},${b.open},${b.high},${b.low},${b.close},${vol},0,0,0,0,${vol}`;
													if (rowMap.get(utcSec) !== newLine) {
														rowMap.set(utcSec, newLine);
														csvChanged = true;
													}
												}
												if (csvChanged) {
													const sortedUtc = Array.from(rowMap.keys()).sort((a, b) => a - b);
													const outPayload = sortedUtc.map(k => rowMap.get(k)).join('\r\n') + '\r\n';
													const outBuf = Buffer.from(outPayload, 'utf8');
													fs.ftruncateSync(fd, cleanStartOffset);
													fs.writeSync(fd, outBuf, 0, outBuf.length, cleanStartOffset);
												}
											} finally {
												fs.closeSync(fd);
											}
										}
									} else if (tfNum === 1440) {
										const dailyCsvPath = resolve(__dirname, `../../data/${exSym}.csv`);
										if (fs.existsSync(dailyCsvPath)) {
											const content = fs.readFileSync(dailyCsvPath, 'utf8');
											const lines = content.split(/\r?\n/).filter(Boolean);
											const header = lines[0];
											const rowMap = new Map();
											for (let i = 1; i < lines.length; i++) {
												const parts = lines[i].split(',');
												if (parts[0]) rowMap.set(parts[0], { raw: lines[i], close: Number(parts[4]) });
											}
											for (const b of bars) {
												const dateStr = new Date(Number(b.time) * 1000).toISOString().slice(0, 10);
												const avg = ((Number(b.high) + Number(b.low) + Number(b.close)) / 3).toFixed(5);
												const vol = Math.round(Number(b.volume || 0));
												rowMap.set(dateStr, {
													open: Number(b.open),
													high: Number(b.high),
													low: Number(b.low),
													close: Number(b.close),
													avg,
													vol,
												});
											}
											const sortedDates = Array.from(rowMap.keys()).sort();
											const outLines = [header];
											let prevClose = null;
											for (const d of sortedDates) {
												const item = rowMap.get(d);
												if (item.raw && item.open === undefined) {
													outLines.push(item.raw);
													prevClose = item.close;
												} else {
													const chg = prevClose ? (item.close - prevClose).toFixed(3) : '0';
													const chgPct = prevClose ? (((item.close - prevClose) / prevClose) * 100).toFixed(2) : '0';
													outLines.push(`${d},${item.open},${item.high},${item.low},${item.close},${item.avg},${item.vol},0,0,${chg},${chgPct},0,0,0`);
													prevClose = item.close;
												}
											}
											fs.writeFileSync(dailyCsvPath, outLines.join('\r\n') + '\r\n', 'utf8');
										}
									}
								} catch (_persistErr) {}
							});
						}
					} catch (err) {
						res.statusCode = 500;
						res.end(JSON.stringify({ error: err.message }));
					}
				});

				// 5. Open Positions & Pending Orders Endpoint (GET /api/exness/positions)
				server.middlewares.use('/api/exness/positions', async (_req, res) => {
					res.setHeader('Content-Type', 'application/json');
					try {
						const { token, exServer, account, host } = readExnessEnv();
						if (!token) {
							res.statusCode = 401;
							res.end(JSON.stringify({ error: 'No EXNESS_TOKEN' }));
							return;
						}
						const headers = {
							'Authorization': `Bearer ${token}`,
							'Accept': 'application/json',
							'Origin': 'https://my.exness.com',
							'User-Agent': 'Mozilla/5.0',
						};
						const [posRes, ordRes] = await Promise.all([
							fetch(`https://${host}/rtapi/mt5/${exServer}/v1/accounts/${account}/positions`, { headers }),
							fetch(`https://${host}/rtapi/mt5/${exServer}/v1/accounts/${account}/orders`, { headers }).catch(() => null),
						]);

						if (posRes.status === 401 || posRes.status === 403) {
							tokenValid = false;
							upstreamConnected = false;
							broadcastStatus();
						}

						if (!posRes.ok) {
							const fallbackPath = resolve(__dirname, '../public/exness_open_positions.json');
							if (fs.existsSync(fallbackPath)) {
								res.end(fs.readFileSync(fallbackPath, 'utf8'));
								return;
							}
							res.statusCode = posRes.status;
							res.end(JSON.stringify({ error: `Exness status ${posRes.status}` }));
							return;
						}

						tokenValid = true;
						const posData = await posRes.json();
						const ordData = ordRes && ordRes.ok ? await ordRes.json() : { orders: [] };
						const rawPositions = Array.isArray(posData.positions) ? posData.positions : [];
						const rawOrders = Array.isArray(ordData.orders) ? ordData.orders : [];

						const formattedPositions = [];
						const seenTickets = new Set();

						for (const p of rawPositions) {
							const tId = String(p.ticket_id || p.position_id || p.id || '');
							if (!tId || seenTickets.has(tId)) continue;
							seenTickets.add(tId);

							const rawTs = Number(p.open_time || p.time || 0);
							const oTs = rawTs > 1e11 ? Math.floor(rawTs / 1000) : Math.floor(rawTs);
							const wib = formatWibDateTime(oTs);

							const isShort = p.type === 1;
							const tType = isShort ? 'SELL' : 'BUY';
							const symName = p.instrument || p.symbol || '';
							const liveTick = lastTicks.get(symName);
							const op = Number(p.open_price || 0);
							const liveTickPrice = liveTick ? Number(isShort ? (liveTick.ask || liveTick.price) : (liveTick.bid || liveTick.price)) : 0;
							const curP = Number(liveTickPrice || p.current_price || p.price || p.close_price || op);
							const lot = Number(p.volume || 0);
							const priceDiff = (curP - op) * (isShort ? -1 : 1);
							let pnl = Number(p.profit ?? p.unrealized_profit ?? 0);
							if ((!pnl || liveTickPrice > 0) && op > 0 && curP > 0 && lot > 0) {
								const upperSym = symName.toUpperCase();
								if (upperSym.startsWith('XAU')) {
									pnl = priceDiff * lot * 100;
								} else if (upperSym.startsWith('BTC')) {
									pnl = priceDiff * lot * 1;
								} else if (upperSym.startsWith('USDJPY') || upperSym.startsWith('USDCAD') || upperSym.startsWith('USDCHF')) {
									pnl = (priceDiff / curP) * lot * 100000;
								} else {
									pnl = priceDiff * lot * 100000;
								}
								pnl += Number(p.commission || 0) + Number(p.swap || 0);
							}
							const pct = op > 0 ? Number(((priceDiff / op) * 100).toFixed(2)) : 0;

							formattedPositions.push({
								id: tId,
								ticket: tId,
								symbol: p.instrument || p.symbol || '',
								type: tType,
								command: tType,
								entry_time: wib.fakeUtcSec,
								entry_time_utc: oTs,
								entry_datetime: wib.datetimeStr,
								entry_date: wib.dateStr,
								entry_price: op,
								current_price: curP,
								exit_time: 0,
								exit_datetime: '',
								exit_date: '',
								exit_price: curP,
								lot,
								shares: lot,
								stop_loss: p.sl ? Number(p.sl) : null,
								take_profit: p.tp ? Number(p.tp) : null,
								sl: p.sl ? Number(p.sl) : null,
								tp: p.tp ? Number(p.tp) : null,
								commission: Number(p.commission || 0),
								swap: Number(p.swap || 0),
								realized_amount: Number(pnl.toFixed(2)),
								realized_percentage: pct,
								is_win: pnl >= 0,
								is_day_trade: false,
								is_open: true,
								is_pending: false,
								currency: 'USC',
							});
						}

						res.end(JSON.stringify({
							ok: true,
							status: 'ok',
							account,
							server: exServer,
							positions_count: formattedPositions.length,
							orders_count: rawOrders.length,
							positions: formattedPositions,
							raw_positions: rawPositions,
							orders: rawOrders,
							updated_at: Math.floor(Date.now() / 1000),
						}));
					} catch (err) {
						const fallbackPath = resolve(__dirname, '../public/exness_open_positions.json');
						if (fs.existsSync(fallbackPath)) {
							res.end(fs.readFileSync(fallbackPath, 'utf8'));
							return;
						}
						res.statusCode = 500;
						res.end(JSON.stringify({ error: err.message }));
					}
				});

				// 6. Closed Trade History Endpoint (GET /api/exness/history)
				server.middlewares.use('/api/exness/history', async (_req, res) => {
					res.setHeader('Content-Type', 'application/json');
					try {
						const { token, exServer, account, host } = readExnessEnv();
						if (!token) {
							const fallbackPath = resolve(__dirname, '../public/forex_trade_history_2026.json');
							if (fs.existsSync(fallbackPath)) {
								res.end(fs.readFileSync(fallbackPath, 'utf8'));
								return;
							}
							res.statusCode = 401;
							res.end(JSON.stringify({ error: 'No EXNESS_TOKEN' }));
							return;
						}

						const urlHistory = `https://${host}/rtapi/mt5/${exServer}/v2/accounts/${account}/positions/history?from_date=1767225600000&to_date=4102444800000&show_balance=false`;
						const r = await fetch(urlHistory, {
							headers: {
								'Authorization': `Bearer ${token}`,
								'Accept': 'application/json',
								'Origin': 'https://my.exness.com',
								'User-Agent': 'Mozilla/5.0',
							},
						});

						if (!r.ok) {
							const fallbackPath = resolve(__dirname, '../public/forex_trade_history_2026.json');
							if (fs.existsSync(fallbackPath)) {
								res.end(fs.readFileSync(fallbackPath, 'utf8'));
								return;
							}
							res.statusCode = r.status;
							res.end(JSON.stringify({ error: `Exness history status ${r.status}` }));
							return;
						}

						const data = await r.json();
						const rawHistory = Array.isArray(data.positions) ? data.positions : [];
						const nowWib = formatWibDateTime(Math.floor(Date.now() / 1000));
						const currentMonthPrefix = nowWib.dateStr.slice(0, 7);

						const formattedTrades = [];
						for (const p of rawHistory) {
							const openRaw = Number(p.open_time || 0);
							const closeRaw = Number(p.close_time || 0);
							const openTs = openRaw > 1e11 ? Math.floor(openRaw / 1000) : Math.floor(openRaw);
							const closeTs = closeRaw > 1e11 ? Math.floor(closeRaw / 1000) : Math.floor(closeRaw);
							const openWib = formatWibDateTime(openTs);
							const closeWib = formatWibDateTime(closeTs);

							if (!closeWib.dateStr.startsWith(currentMonthPrefix)) continue;

							const isShort = p.type === 1;
							const tType = isShort ? 'SELL' : 'BUY';
							const op = Number(p.open_price || 0);
							const cp = Number(p.close_price || 0);
							const lot = Number(p.volume || 0);
							const pnl = Number(p.profit || 0);
							const pct = op > 0 ? Number((((cp - op) / op) * 100 * (isShort ? -1 : 1)).toFixed(2)) : 0;

							formattedTrades.push({
								id: String(p.ticket_id || p.position_id),
								ticket: String(p.ticket_id || p.position_id),
								symbol: p.instrument || '',
								type: tType,
								command: tType,
								entry_time: openWib.fakeUtcSec,
								entry_time_utc: openTs,
								entry_datetime: openWib.datetimeStr,
								entry_date: openWib.dateStr,
								entry_price: op,
								exit_time: closeWib.fakeUtcSec,
								exit_time_utc: closeTs,
								exit_datetime: closeWib.datetimeStr,
								exit_date: closeWib.dateStr,
								exit_price: cp,
								lot,
								shares: lot,
								stop_loss: p.sl ? Number(p.sl) : null,
								take_profit: p.tp ? Number(p.tp) : null,
								sl: p.sl ? Number(p.sl) : null,
								tp: p.tp ? Number(p.tp) : null,
								commission: Number(p.commission || 0),
								swap: Number(p.swap || 0),
								realized_amount: Number(pnl.toFixed(2)),
								realized_percentage: pct,
								is_win: pnl >= 0,
								is_day_trade: openWib.dateStr === closeWib.dateStr,
								is_open: false,
								close_reason: p.comment || (p.reason === 4 ? 'tp' : (p.reason === 3 ? 'sl' : 'user')),
								currency: 'USC',
							});
						}

						formattedTrades.sort((a, b) => a.exit_time - b.exit_time);
						const wins = formattedTrades.filter(t => t.is_win);
						const losses = formattedTrades.filter(t => !t.is_win);
						const grossProfit = wins.reduce((acc, t) => acc + t.realized_amount, 0);
						const grossLoss = Math.abs(losses.reduce((acc, t) => acc + t.realized_amount, 0));
						const netPnl = formattedTrades.reduce((acc, t) => acc + t.realized_amount, 0);

						res.end(JSON.stringify({
							ok: true,
							status: 'ok',
							summary: {
								total_trades: formattedTrades.length,
								total_positions: formattedTrades.length,
								wins: wins.length,
								losses: losses.length,
								total_realized_pnl: Number(netPnl.toFixed(2)),
								win_rate: formattedTrades.length > 0 ? Number(((wins.length / formattedTrades.length) * 100).toFixed(1)) : 0,
								gross_profit: Number(grossProfit.toFixed(2)),
								gross_loss: Number(grossLoss.toFixed(2)),
								profit_factor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : 0,
								currency: 'USC',
							},
							trades: formattedTrades,
							positions: formattedTrades,
						}));
					} catch (err) {
						const fallbackPath = resolve(__dirname, '../public/forex_trade_history_2026.json');
						if (fs.existsSync(fallbackPath)) {
							res.end(fs.readFileSync(fallbackPath, 'utf8'));
							return;
						}
						res.statusCode = 500;
						res.end(JSON.stringify({ error: err.message }));
					}
				});

				// ================= STOCKBIT NATIVE GATEWAY (IHSG CANDLES, PORTFOLIO, ORDERS & HISTORY) =================
				const stockbitBaseHeaders = {
					'Accept': 'application/json',
					'Origin': 'https://stockbit.com',
					'Referer': 'https://stockbit.com/',
					'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
					'Cache-Control': 'no-cache',
				};

				function getStockbitStatus() {
					const { socialToken, refreshToken, secToken } = readStockbitEnv();
					const nowSec = Math.floor(Date.now() / 1000);
					const socialExp = decodeJwtExp(socialToken);
					const secExp = decodeJwtExp(secToken);
					const refreshExp = decodeJwtExp(refreshToken);

					const socialValid = Boolean(socialToken && (!socialExp || socialExp > nowSec));
					const secValid = Boolean(secToken && (!secExp || secExp > nowSec));
					const remainingSeconds = socialExp ? Math.max(0, socialExp - nowSec) : 0;
					const secRemainingSeconds = secExp ? Math.max(0, secExp - nowSec) : 0;
					const refreshRemainingSeconds = refreshExp ? Math.max(0, refreshExp - nowSec) : 0;
					const tokenPreview = socialToken ? `${socialToken.slice(0, 14)}...${socialToken.slice(-10)}` : '';
					const secTokenPreview = secToken ? `${secToken.slice(0, 14)}...${secToken.slice(-10)}` : '';

					return {
						ok: true,
						status: 'ok',
						tokenValid: socialValid,
						secTokenValid: secValid,
						hasToken: Boolean(socialToken),
						hasSecToken: Boolean(secToken),
						remainingSeconds,
						secRemainingSeconds,
						refreshRemainingSeconds,
						tokenPreview,
						secTokenPreview,
					};
				}

				// 7. Stockbit Status Endpoint (GET /api/stockbit/status)
				server.middlewares.use('/api/stockbit/status', (_req, res) => {
					res.setHeader('Content-Type', 'application/json');
					res.end(JSON.stringify(getStockbitStatus()));
				});

				// 8. Stockbit Token / Cookie Update Endpoint (POST /api/stockbit/token)
				server.middlewares.use('/api/stockbit/token', (req, res) => {
					if (req.method !== 'POST') {
						res.statusCode = 405;
						res.end(JSON.stringify({ ok: false, error: 'Method not allowed' }));
						return;
					}
					let body = '';
					req.on('data', chunk => { body += chunk.toString(); });
					req.on('end', async () => {
						res.setHeader('Content-Type', 'application/json');
						try {
							const parsedBody = JSON.parse(body || '{}');
							const rawInput = parsedBody.token || parsedBody.cookie || '';
							const extracted = parseStockbitInput(rawInput);

							if (!extracted.socialToken && !extracted.secToken && !extracted.refreshToken) {
								res.statusCode = 400;
								res.end(JSON.stringify({ ok: false, error: 'Cookie atau Token Stockbit kosong / tidak ditemukan' }));
								return;
							}

							const nowSec = Math.floor(Date.now() / 1000);
							if (extracted.socialToken) {
								const exp = decodeJwtExp(extracted.socialToken);
								if (exp && exp <= nowSec) {
									res.statusCode = 400;
									res.end(JSON.stringify({ ok: false, error: 'Token Stockbit (Social/Chart) sudah kedaluwarsa (Expired)' }));
									return;
								}
							}
							if (extracted.secToken) {
								const expSec = decodeJwtExp(extracted.secToken);
								if (expSec && expSec <= nowSec && !extracted.socialToken) {
									res.statusCode = 400;
									res.end(JSON.stringify({ ok: false, error: 'Token Stockbit Sekuritas sudah kedaluwarsa (Expired)' }));
									return;
								}
							}

							saveStockbitTokensToEnv(extracted);
							res.end(JSON.stringify({
								...getStockbitStatus(),
								ok: true,
							}));
						} catch (err) {
							res.statusCode = 500;
							res.end(JSON.stringify({ ok: false, error: err.message }));
						}
					});
				});

				// 9. Stockbit Authoritative Candles Endpoint (GET /api/stockbit/candles?symbol=SRSN&tf=1m|1d)
				server.middlewares.use('/api/stockbit/candles', async (req, res) => {
					res.setHeader('Content-Type', 'application/json');
					try {
						const urlObj = new URL(req.url || '', 'http://localhost');
						const { socialToken } = readStockbitEnv();
						if (!socialToken) {
							res.statusCode = 401;
							res.end(JSON.stringify({ ok: false, error: 'No STOCKBIT_TOKEN' }));
							return;
						}

						const exp = decodeJwtExp(socialToken);
						if (exp && exp <= Math.floor(Date.now() / 1000)) {
							res.statusCode = 401;
							res.end(JSON.stringify({ ok: false, error: 'STOCKBIT_TOKEN expired' }));
							return;
						}

						const sym = String(urlObj.searchParams.get('symbol') || 'IHSG').trim().toUpperCase();
						const tfParam = String(urlObj.searchParams.get('tf') || '1m').trim().toLowerCase();
						const headers = {
							...stockbitBaseHeaders,
							'Authorization': `Bearer ${socialToken}`,
						};

						if (tfParam === '1d' || tfParam === '1440' || tfParam === 'daily') {
							const nowMs = Date.now() + WIB_OFFSET_SEC * 1000;
							const endDateStr = new Date(nowMs + 86400 * 1000).toISOString().slice(0, 10);
							const startDateStr = new Date(nowMs - 120 * 86400 * 1000).toISOString().slice(0, 10);
							const chartbitDailyUrl = `https://exodus.stockbit.com/chartbit/${encodeURIComponent(sym)}/price/daily?from=${endDateStr}&to=${startDateStr}&limit=0`;
							const summaryUrl = sym !== 'IHSG'
								? `https://exodus.stockbit.com/company-price-feed/historical/summary/${encodeURIComponent(sym)}?limit=50&page=1`
								: null;

							const [cbRes, sumRes] = await Promise.all([
								fetch(chartbitDailyUrl, { headers }).catch(() => null),
								summaryUrl ? fetch(summaryUrl, { headers }).catch(() => null) : Promise.resolve(null),
							]);

							if ((!cbRes || !cbRes.ok) && (!sumRes || !sumRes.ok)) {
								const errStatus = cbRes ? cbRes.status : (sumRes ? sumRes.status : 500);
								res.statusCode = errStatus;
								res.end(JSON.stringify({ ok: false, error: `Stockbit daily HTTP ${errStatus}` }));
								return;
							}

							const cbPayload = cbRes && cbRes.ok ? await cbRes.json() : {};
							const sumPayload = sumRes && sumRes.ok ? await sumRes.json() : {};
							const cbRows = Array.isArray(cbPayload?.data?.chartbit) ? cbPayload.data.chartbit : [];
							const sumRows = Array.isArray(sumPayload?.data?.result) ? sumPayload.data.result : [];

							const sumByDate = new Map();
							for (const sRow of sumRows) {
								if (sRow && sRow.date) sumByDate.set(String(sRow.date), sRow);
							}

							const bars = [];
							const sourceRows = cbRows.length > 0 ? cbRows : sumRows;
							for (const row of sourceRows) {
								if (!row || !row.date) continue;
								const dateStr = String(row.date);
								const timeSec = Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);
								if (!timeSec || isNaN(timeSec)) continue;
								const sMatch = sumByDate.get(dateStr) || {};
								const fb = Number(sMatch.foreign_buy ?? row.foreign_buy ?? row.foreignbuy ?? 0);
								const fsell = Number(sMatch.foreign_sell ?? row.foreign_sell ?? row.foreignsell ?? 0);
								const lotVol = Number(sMatch.volume ?? row.lot ?? Math.round(Number(row.volume || 0) / 100));
								const val = Number(sMatch.value ?? row.value ?? 0);
								const closePx = Number(row.close ?? sMatch.close ?? 0);
								const avgPx = Number(sMatch.average || (lotVol > 0 && val > 0 ? Math.round(val / (lotVol * 100)) : closePx));
								bars.push({
									time: timeSec,
									date: dateStr,
									open: Number(row.open || closePx || 0),
									high: Number(row.high || closePx || 0),
									low: Number(row.low || closePx || 0),
									close: closePx,
									average: avgPx,
									volume: lotVol,
									value: val,
									frequency: Number(sMatch.frequency ?? row.frequency ?? 0),
									change: Number(sMatch.change ?? row.change ?? 0),
									change_percentage: Number(sMatch.change_percentage ?? row.change_percentage ?? 0),
									foreign_buy: fb,
									foreign_sell: fsell,
									net_foreign: Number(sMatch.net_foreign ?? (fb - fsell)),
								});
							}
							bars.sort((a, b) => a.time - b.time);
							for (let i = 1; i < bars.length; i++) {
								if (!bars[i].change && bars[i - 1].close > 0) {
									const chg = Number((bars[i].close - bars[i - 1].close).toFixed(2));
									bars[i].change = chg;
									bars[i].change_percentage = Number(((chg / bars[i - 1].close) * 100).toFixed(2));
								}
							}

							// Persist in background to public/${sym}_1d.json, data/${sym}.csv, and screener.json
							if (bars.length > 0) {
								setImmediate(() => {
									try {
										const jsonPath = resolve(__dirname, `../public/${sym}_1d.json`);
										if (fs.existsSync(jsonPath)) {
											const existingRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
											if (Array.isArray(existingRaw) && existingRaw.length > 0) {
												const mapByTime = new Map();
												for (let i = 0; i < existingRaw.length; i++) {
													const tVal = typeof existingRaw[i].time === 'string'
														? Math.floor(Date.parse(`${existingRaw[i].time.slice(0, 10)}T00:00:00Z`) / 1000)
														: Number(existingRaw[i].time);
													mapByTime.set(tVal, i);
												}
												let changed = false;
												let outOfOrder = false;
												for (const b of bars) {
													const idx = mapByTime.get(b.time);
													const cleanObj = {
														time: b.time,
														open: b.open,
														high: b.high,
														low: b.low,
														close: b.close,
														volume: b.volume,
														value: b.value,
														average: b.average,
														frequency: b.frequency,
														change: b.change,
														change_percentage: b.change_percentage,
														foreign_buy: b.foreign_buy,
														foreign_sell: b.foreign_sell,
														net_foreign: b.net_foreign,
													};
													if (idx !== undefined) {
														const ex = existingRaw[idx];
														if (ex.close !== b.close || ex.volume !== b.volume || ex.high !== b.high || ex.low !== b.low) {
															existingRaw[idx] = { ...ex, ...cleanObj };
															changed = true;
														}
													} else {
														const lastT = Number(existingRaw[existingRaw.length - 1]?.time || 0);
														if (b.time < lastT) outOfOrder = true;
														existingRaw.push(cleanObj);
														mapByTime.set(b.time, existingRaw.length - 1);
														changed = true;
													}
												}
												if (outOfOrder) {
													existingRaw.sort((a, b) => Number(a.time) - Number(b.time));
												}
												if (changed) {
													fs.writeFileSync(jsonPath, JSON.stringify(existingRaw), 'utf8');
												}
											}
										}

										// Persist to data/${sym}.csv
										const csvPath = resolve(__dirname, `../../data/${sym}.csv`);
										if (fs.existsSync(csvPath)) {
											const rawCsv = fs.readFileSync(csvPath, 'utf8');
											const csvLines = rawCsv.split(/\r?\n/).filter(Boolean);
											if (csvLines.length > 0) {
												const header = csvLines[0];
												const rowMap = new Map();
												for (let i = 1; i < csvLines.length; i++) {
													const dKey = csvLines[i].split(',')[0];
													if (dKey) rowMap.set(dKey, csvLines[i]);
												}
												let csvChanged = false;
												for (const b of bars) {
													const newLine = `${b.date},${b.open},${b.high},${b.low},${b.close},${b.average},${b.volume},${b.value},${b.frequency},${b.change},${b.change_percentage},${b.foreign_buy},${b.foreign_sell},${b.net_foreign}`;
													if (rowMap.get(b.date) !== newLine) {
														rowMap.set(b.date, newLine);
														csvChanged = true;
													}
												}
												if (csvChanged) {
													const sortedDates = Array.from(rowMap.keys()).sort();
													const outCsv = [header, ...sortedDates.map(k => rowMap.get(k))].join('\n') + '\n';
													fs.writeFileSync(csvPath, outCsv, 'utf8');
												}
											}
										}

										// Update screener.json in-place for this symbol
										const latestBar = bars[bars.length - 1];
										const screenerPath = resolve(__dirname, '../public/screener.json');
										if (latestBar && fs.existsSync(screenerPath)) {
											const scrArr = JSON.parse(fs.readFileSync(screenerPath, 'utf8'));
											if (Array.isArray(scrArr)) {
												const sIdx = scrArr.findIndex(x => x && x.symbol === sym);
												if (sIdx >= 0) {
													const item = scrArr[sIdx];
													if (item.price !== latestBar.close || item.volume !== latestBar.volume) {
														item.price = latestBar.close;
														item.change = latestBar.change;
														item.change_percentage = latestBar.change_percentage;
														item.volume = latestBar.volume;
														item.value = latestBar.value;
														item.frequency = latestBar.frequency;
														item.net_foreign = latestBar.net_foreign;
														item.time = latestBar.time;
														fs.writeFileSync(screenerPath, JSON.stringify(scrArr), 'utf8');
													}
												}
											}
										}
									} catch (_e) {}
								});
							}

							res.end(JSON.stringify({
								ok: true,
								status: 'ok',
								symbol: sym,
								tf: '1d',
								count: bars.length,
								bars,
								candles: bars,
							}));
							return;
						}

						// Intraday 1m (chartbit/{sym}/price/intraday)
						const nowSec = Math.floor(Date.now() / 1000);
						const fromParam = Number(urlObj.searchParams.get('from') || 0);
						// Stockbit chartbit intraday uses `from` = newer timestamp and `to` = older timestamp
						const startSec = fromParam > 0 ? Math.max(fromParam - 3600, nowSec - 14 * 86400) : (nowSec - 7 * 86400);
						const endSec = nowSec + 60;
						const intradayUrl = `https://exodus.stockbit.com/chartbit/${encodeURIComponent(sym)}/price/intraday?from=${endSec}&to=${startSec}&limit=0`;
						const r = await fetch(intradayUrl, { headers });
						if (!r.ok) {
							res.statusCode = r.status;
							res.end(JSON.stringify({ ok: false, error: `Stockbit intraday HTTP ${r.status}` }));
							return;
						}
						const payload = await r.json();
						const rawChartbit = Array.isArray(payload?.data?.chartbit) ? payload.data.chartbit : [];
						const bars = [];
						for (const row of rawChartbit) {
							const utcSec = Number(row.unix_timestamp || 0);
							if (!utcSec || isNaN(utcSec)) continue;
							const fakeWibSec = utcSec + WIB_OFFSET_SEC;
							const sharesVol = Number(row.volume || 0);
							const lotVol = Number(row.lot || Math.round(sharesVol / 100));
							bars.push({
								time: fakeWibSec,
								utcTime: utcSec,
								datetime: String(row.datetime || ''),
								open: Number(row.open || row.close || 0),
								high: Number(row.high || row.close || 0),
								low: Number(row.low || row.close || 0),
								close: Number(row.close || 0),
								volume: lotVol,
								sharesVolume: sharesVol,
								value: Number(row.value || 0),
								frequency: Number(row.frequency || 0),
								foreign_buy: Number(row.foreign_buy || 0),
								foreign_sell: Number(row.foreign_sell || 0),
							});
						}
						bars.sort((a, b) => a.time - b.time);

						if (bars.length > 0) {
							setImmediate(() => {
								try {
									const jsonPath = resolve(__dirname, `../public/${sym}_1m.json`);
									if (fs.existsSync(jsonPath)) {
										const existingRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
										if (Array.isArray(existingRaw) && existingRaw.length > 0) {
											const minExistingTime = Number(existingRaw[0].time || 0);
											const mapByTime = new Map();
											const scanStart = Math.max(0, existingRaw.length - 10000);
											for (let i = scanStart; i < existingRaw.length; i++) {
												mapByTime.set(Number(existingRaw[i].time), i);
											}
											let changed = false;
											let insertedOutOfOrder = false;
											for (const b of bars) {
												if (b.time < minExistingTime) continue;
												const idx = mapByTime.get(b.time);
												if (idx !== undefined) {
													const ex = existingRaw[idx];
													if (ex.open !== b.open || ex.high !== b.high || ex.low !== b.low || ex.close !== b.close || ex.volume !== b.volume) {
														ex.open = b.open;
														ex.high = b.high;
														ex.low = b.low;
														ex.close = b.close;
														ex.volume = b.volume;
														changed = true;
													}
												} else {
													const lastTime = Number(existingRaw[existingRaw.length - 1].time || 0);
													if (b.time < lastTime) insertedOutOfOrder = true;
													existingRaw.push({
														time: b.time,
														open: b.open,
														high: b.high,
														low: b.low,
														close: b.close,
														volume: b.volume,
													});
													mapByTime.set(b.time, existingRaw.length - 1);
													changed = true;
												}
											}
											if (insertedOutOfOrder) {
												existingRaw.sort((a, b) => Number(a.time) - Number(b.time));
											}
											if (changed) {
												fs.writeFileSync(jsonPath, JSON.stringify(existingRaw), 'utf8');
											}
										}
									}

									// Persist to SD Card CSV (data_intraday/${sym}_intraday.csv) using 512KB tail buffer
									const sdCsvPath = resolve(__dirname, `../../data_intraday/${sym}_intraday.csv`);
									if (fs.existsSync(sdCsvPath)) {
										const stat = fs.statSync(sdCsvPath);
										const tailBytes = Math.min(stat.size, 512 * 1024);
										const fd = fs.openSync(sdCsvPath, 'r+');
										try {
											const buf = Buffer.alloc(tailBytes);
											const readOffset = stat.size - tailBytes;
											fs.readSync(fd, buf, 0, tailBytes, readOffset);
											const tailStr = buf.toString('utf8');
											const firstNl = readOffset > 0 ? tailStr.indexOf('\n') : -1;
											const cleanStartOffset = readOffset + (firstNl >= 0 ? firstNl + 1 : 0);
											const cleanStr = firstNl >= 0 ? tailStr.slice(firstNl + 1) : tailStr;
											const lines = cleanStr.split(/\r?\n/).filter(Boolean);
											const rowMap = new Map();
											let minTailUtc = Infinity;
											for (const line of lines) {
												if (line.includes('unix_timestamp')) continue;
												const parts = line.split(',');
												const utcTs = Number(parts[1]);
												if (utcTs > 0) {
													if (utcTs < minTailUtc) minTailUtc = utcTs;
													rowMap.set(utcTs, line);
												}
											}
											let csvChanged = false;
											for (const b of bars) {
												const utcTs = Number(b.utcTime);
												if (!utcTs || (minTailUtc !== Infinity && utcTs < minTailUtc)) continue;
												const dtStr = b.datetime || formatWibDateTime(utcTs).datetimeStr;
												const newLine = `${dtStr},${utcTs},${sym},${b.open},${b.high},${b.low},${b.close},${b.sharesVolume},${b.value},${b.frequency},${b.foreign_buy},${b.foreign_sell},${b.volume}`;
												if (rowMap.get(utcTs) !== newLine) {
													rowMap.set(utcTs, newLine);
													csvChanged = true;
												}
											}
											if (csvChanged) {
												const sortedKeys = Array.from(rowMap.keys()).sort((a, b) => a - b);
												const outLines = [];
												if (cleanStartOffset === 0) {
													outLines.push('datetime,unix_timestamp,symbol,open,high,low,close,volume,value,frequency,foreign_buy,foreign_sell,lot');
												}
												for (const k of sortedKeys) {
													outLines.push(rowMap.get(k));
												}
												const outBuf = Buffer.from(outLines.join('\n') + '\n', 'utf8');
												fs.ftruncateSync(fd, cleanStartOffset);
												fs.writeSync(fd, outBuf, 0, outBuf.length, cleanStartOffset);
											}
										} finally {
											fs.closeSync(fd);
										}
									}
								} catch (_e) {}
							});
						}

						res.end(JSON.stringify({
							ok: true,
							status: 'ok',
							symbol: sym,
							tf: '1m',
							count: bars.length,
							bars,
							candles: bars,
						}));
					} catch (err) {
						res.statusCode = 500;
						res.end(JSON.stringify({ ok: false, error: err.message }));
					}
				});

				// Keep Stockbit Securities PIN session alive every 3 minutes while secToken is valid
				setInterval(async () => {
					try {
						const { secToken } = readStockbitEnv();
						if (!secToken) return;
						const exp = decodeJwtExp(secToken);
						if (exp && exp <= Math.floor(Date.now() / 1000)) return;
						await fetch('https://carina.stockbit.com/auth/v1/session', {
							headers: {
								...stockbitBaseHeaders,
								'Authorization': `Bearer ${secToken}`,
							},
						}).catch(() => null);
					} catch (_e) {}
				}, 180000);

				function refreshCachedOpenPositionsPrices(cachedJson) {
					if (!cachedJson || !Array.isArray(cachedJson.open_positions)) return [];
					return cachedJson.open_positions.map(pos => {
						const sym = String(pos?.symbol || '').toUpperCase().trim();
						let curPx = Number(pos.current_price || pos.entry_price || 0);
						try {
							const dPath = resolve(__dirname, `../public/${sym}_1d.json`);
							if (fs.existsSync(dPath)) {
								const dArr = JSON.parse(fs.readFileSync(dPath, 'utf8'));
								if (Array.isArray(dArr) && dArr.length > 0) {
									const lastClose = Number(dArr[dArr.length - 1]?.close || 0);
									if (lastClose > 0) curPx = lastClose;
								}
							}
						} catch (_e) {}
						const entryPx = Number(pos.entry_price || 0);
						const shares = Number(pos.shares || (Number(pos.lot || 0) * 100));
						const unPnl = Math.round((curPx - entryPx) * shares);
						const unPct = entryPx > 0 ? Number((((curPx - entryPx) / entryPx) * 100).toFixed(2)) : 0;
						return {
							...pos,
							current_price: curPx,
							exit_price: curPx,
							realized_amount: unPnl,
							realized_percentage: unPct,
							is_win: unPnl >= 0,
						};
					});
				}

				// 10. Stockbit Live Portfolio, Smart Orders (TP/SL/TS) & Trade History Endpoint (GET /api/stockbit/portfolio)
				server.middlewares.use('/api/stockbit/portfolio', async (_req, res) => {
					res.setHeader('Content-Type', 'application/json');
					const fallbackPath = resolve(__dirname, '../public/stockbit_trade_history_2026.json');
					try {
						const { secToken } = readStockbitEnv();
						const cachedJson = fs.existsSync(fallbackPath)
							? JSON.parse(fs.readFileSync(fallbackPath, 'utf8'))
							: { summary: {}, trades: [], positions: [], open_positions: [], cashflow: {} };

						const syncedCachedOpen = refreshCachedOpenPositionsPrices(cachedJson);

						if (!secToken) {
							res.end(JSON.stringify({ ...cachedJson, ok: true, cached: true, open_positions: syncedCachedOpen, openPositions: syncedCachedOpen }));
							return;
						}

						const exp = decodeJwtExp(secToken);
						if (exp && exp <= Math.floor(Date.now() / 1000)) {
							res.end(JSON.stringify({ ...cachedJson, ok: true, cached: true, open_positions: syncedCachedOpen, openPositions: syncedCachedOpen, error: 'STOCKBIT_SECURITIES_TOKEN expired' }));
							return;
						}

						const headers = {
							...stockbitBaseHeaders,
							'Authorization': `Bearer ${secToken}`,
						};

						const [portRes, ordRes, histRes] = await Promise.all([
							fetch('https://carina.stockbit.com/portfolio/v2/list', { headers }).catch(() => null),
							fetch('https://carina.stockbit.com/order/v2/list', { headers }).catch(() => null),
							fetch('https://carina.stockbit.com/history?page=1&period=all&limit=100&keyword=', { headers }).catch(() => null),
						]);

						if (!portRes || !portRes.ok) {
							res.end(JSON.stringify({ ...cachedJson, ok: true, cached: true, pinSessionIdle: true, open_positions: syncedCachedOpen, openPositions: syncedCachedOpen }));
							return;
						}

						const portData = await portRes.json();
						const ordData = ordRes && ordRes.ok ? await ordRes.json() : { data: [] };
						const histData = histRes && histRes.ok ? await histRes.json() : { data: { history: [] } };

						const rawPortfolio = Array.isArray(portData?.data?.results) ? portData.data.results : [];
						const rawOrders = Array.isArray(ordData?.data) ? ordData.data : [];
						const historyGroups = Array.isArray(histData?.data?.history) ? histData.data.history : [];

						// Flatten recent history items to find exact BUY entry time for open positions
						const flatHistory = [];
						for (const g of historyGroups) {
							if (Array.isArray(g?.history_list)) {
								for (const item of g.history_list) {
									flatHistory.push(item);
								}
							}
						}

						// Map active TP / SL / TS smart orders per symbol
						const tpSlBySymbol = new Map();
						for (const ord of rawOrders) {
							const sym = String(ord?.symbol || '').toUpperCase().trim();
							if (!sym) continue;
							const statusTxt = String(ord?.status_text || '').toUpperCase();
							if (statusTxt && statusTxt !== 'READY' && statusTxt !== 'OPEN') continue;

							const entry = tpSlBySymbol.get(sym) || {};
							const label = String(ord?.smart_order?.label || '').toUpperCase();
							const orderPrice = Number(ord?.smart_order?.trigger_price || ord?.price?.order || 0);
							const tsUnits = Number(ord?.smart_order?.trailing_stop?.stop_price?.units || 0);

							if (label === 'TP' && orderPrice > 0) {
								entry.tp = orderPrice;
							} else if (label === 'SL' && orderPrice > 0) {
								entry.sl = orderPrice;
							} else if (label === 'TS') {
								const tsPrice = tsUnits > 0 ? tsUnits : orderPrice;
								if (tsPrice > 0) {
									entry.ts = tsPrice;
									if (!entry.sl) entry.sl = tsPrice;
								}
							}
							tpSlBySymbol.set(sym, entry);
						}

						const liveOpenPositions = [];
						for (const item of rawPortfolio) {
							const sym = String(item?.symbol || '').toUpperCase().trim();
							if (!sym) continue;
							const lot = Number(item?.qty?.balance?.lot || item?.qty?.available?.lot || 0);
							const shares = Number(item?.qty?.balance?.share || item?.qty?.stock_on_hand || (lot * 100));
							if (lot <= 0 && shares <= 0) continue;

							const avgPrice = Number(item?.price?.average?.price || 0);
							const entryPrice = Math.round(avgPrice) || avgPrice;
							const currentPrice = Number(item?.price?.latest || entryPrice);
							const unrealizedPnl = Number(item?.asset?.unrealised?.profit_loss ?? ((currentPrice - entryPrice) * shares));
							const unrealizedPct = Number(item?.asset?.unrealised?.gain != null ? (Number(item.asset.unrealised.gain) * 100).toFixed(2) : (entryPrice > 0 ? (((currentPrice - entryPrice) / entryPrice) * 100).toFixed(2) : 0));

							// Look up latest matching BUY in history for exact entry date & timestamp
							const matchBuy = flatHistory.find(h => String(h?.symbol || '').toUpperCase() === sym && String(h?.command || '').toUpperCase() === 'BUY' && String(h?.status || '').toUpperCase() === 'MATCH');
							const parsedDt = matchBuy
								? parseStockbitHistoryDate(matchBuy.date, matchBuy.time)
								: formatWibDateTime(Math.floor(Date.now() / 1000) - 86400);

							const tpsl = tpSlBySymbol.get(sym) || {};

							liveOpenPositions.push({
								id: String(matchBuy?.id || `OPEN-${sym}`),
								symbol: sym,
								type: 'BUY',
								command: 'BUY',
								entry_time: parsedDt.fakeUtcSec,
								entry_datetime: parsedDt.datetimeStr,
								entry_date: parsedDt.dateStr,
								entry_price: entryPrice,
								current_price: currentPrice,
								exit_time: 0,
								exit_datetime: '',
								exit_date: '',
								exit_price: currentPrice,
								shares,
								lot,
								tp: tpsl.tp || null,
								sl: tpsl.sl || null,
								ts: tpsl.ts || null,
								realized_amount: Math.round(unrealizedPnl),
								realized_percentage: unrealizedPct,
								is_win: unrealizedPnl >= 0,
								is_day_trade: false,
								is_open: true,
								currency: 'IDR',
							});
						}

						// Also merge any new BUY / SELL trades from flatHistory into cachedJson.trades
						const existingTrades = Array.isArray(cachedJson.trades) ? [...cachedJson.trades] : [];
						const existingTradeIds = new Set(existingTrades.map(t => String(t.id)));
						for (const h of flatHistory) {
							const cmd = String(h?.command || '').toUpperCase();
							const status = String(h?.status || '').toUpperCase();
							const hId = String(h?.id || '');
							if ((cmd === 'BUY' || cmd === 'SELL') && status === 'MATCH' && hId && !existingTradeIds.has(hId)) {
								const dt = parseStockbitHistoryDate(h.date, h.time);
								existingTrades.push({
									id: hId,
									timestamp: dt.fakeUtcSec,
									datetime: dt.datetimeStr,
									date: dt.dateStr,
									time: dt.timeStr,
									command: cmd,
									symbol: String(h.symbol || '').toUpperCase().trim(),
									price: Number(h.price || 0),
									lot: Number(h.lot || 0),
									shares: Number(h.shares || 0),
									amount: Number(h.amount || 0),
									fee: Number(h.fee || 0),
									netamount: Number(h.netamount || 0),
									realized_amount: Number(h.realized_amount || 0),
									realized_percentage: Number(h.realized_percentage || 0),
									status: 'MATCH',
									is_day_trade: Boolean(h.is_day_trade),
									display_as: String(h.display_as || `${cmd} ${h.symbol}`),
								});
								existingTradeIds.add(hId);
							}
						}
						existingTrades.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

						const updatedJson = {
							...cachedJson,
							ok: true,
							status: 'ok',
							trades: existingTrades,
							open_positions: liveOpenPositions,
							openPositions: liveOpenPositions,
						};

						setImmediate(() => {
							try {
								fs.writeFileSync(fallbackPath, JSON.stringify(updatedJson, null, 2), 'utf8');
							} catch (_e) {}
						});

						res.end(JSON.stringify(updatedJson));
					} catch (err) {
						if (fs.existsSync(fallbackPath)) {
							res.end(fs.readFileSync(fallbackPath, 'utf8'));
							return;
						}
						res.statusCode = 500;
						res.end(JSON.stringify({ ok: false, error: err.message }));
					}
				});
			}
		}
	],
	server: {
		allowedHosts: true,
		hmr: {
			overlay: false,
		},
		watch: {
			ignored: ['**/public/**/*.json'],
		},
		proxy: {
			'/api-arjum': {
				target: 'https://stock.arjum.com',
				changeOrigin: true,
				secure: false,
				rewrite: (path) => path.replace(/^\/api-arjum/, ''),
				configure: (proxy, _options) => {
					proxy.on('error', (err, _req, res) => {
						if (res && !res.headersSent) {
							res.writeHead(502, { 'Content-Type': 'application/json' });
							res.end(JSON.stringify({ error: 'Proxy upstream error', code: err.code }));
						}
					});
				},
			},
		},
	},
	build: {
		rollupOptions: {
			input,
		},
	},
});
