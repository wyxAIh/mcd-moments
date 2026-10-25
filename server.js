'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MCP_URL = process.env.MCD_MCP_URL || 'https://mcp.mcd.cn';
const MCP_TOKEN = process.env.MCD_MCP_TOKEN || '';
const ROOT = __dirname;
const MAX_BODY_BYTES = 64 * 1024;

const DEMO_ACTIVITY = {
  campaigns: [
    { id: 'demo-summer', title: '夏日轻食能量季', description: '轻负担搭配与活动信息演示数据', period: '以门店实际活动为准' },
    { id: 'demo-breakfast', title: '早餐活力组合', description: '早餐时段组合灵感演示数据', period: '以门店实际活动为准' },
    { id: 'demo-family', title: '分享时刻', description: '多人分享组合灵感演示数据', period: '以门店实际活动为准' }
  ]
};

const DEMO_NUTRITION = {
  foods: [
    { name: '板烧鸡腿堡', caloriesKcal: null, note: '营养数值请以官方最新数据为准' },
    { name: '中薯条', caloriesKcal: null, note: '营养数值请以官方最新数据为准' },
    { name: '玉米杯', caloriesKcal: null, note: '营养数值请以官方最新数据为准' }
  ]
};

const DEMO_CANDIDATES = [
  { id: 'seat-budget', seat: '预算席', title: '够吃就好，不为选择交税', tagline: '预算派 / 把钱花在主食上', items: ['麦香鸡', '小杯玉米杯'], estimatedCaloriesKcal: 422, estimatedPriceCny: 27.5, reason: '同一份菜单里优先选价格直给、够饱的组合；少一个“要不要再加”的纠结。', voteLabel: '我站预算派' },
  { id: 'seat-novelty', seat: '尝鲜席', title: '今天就该试试新口味', tagline: '尝鲜派 / 把新品变成理由', items: ['龙焰鸡腿堡', '蓝莓爆爆珠麦旋风'], estimatedCaloriesKcal: null, estimatedPriceCny: 43.5, reason: '用当期活动和菜单新品，制造一个只有今天才成立的“去麦理由”。', voteLabel: '我站尝鲜派' },
  { id: 'seat-moment', seat: '此刻席', title: '别再开会，去吃点热的', tagline: '此刻派 / 让时间与心情做决定', items: ['板烧鸡腿堡', '小杯玉米杯'], estimatedCaloriesKcal: 444, estimatedPriceCny: 40.5, reason: '你只有 20 分钟、一个人赶稿：这份组合够直接，也不用把时间耗在选餐上。', voteLabel: '我站此刻派' }
];

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function cors(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('Invalid JSON body'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function responseTextFromSse(text) {
  const dataLines = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
  for (let i = dataLines.length - 1; i >= 0; i--) {
    if (!dataLines[i] || dataLines[i] === '[DONE]') continue;
    try {
      const event = JSON.parse(dataLines[i]);
      if (event.result) return event.result;
      if (event.error) throw new Error(event.error.message || 'MCP returned an error');
      return event;
    } catch (err) {
      if (err.message && err.message !== 'Unexpected end of JSON input') throw err;
    }
  }
  throw new Error('MCP returned no JSON-RPC result');
}

async function mcpCall(name, args = {}) {
  if (!MCP_TOKEN) throw new Error('MCD_MCP_TOKEN is not configured');
  const endpoint = new URL(MCP_URL);
  if (endpoint.protocol !== 'https:' && endpoint.hostname !== 'localhost' && endpoint.hostname !== '127.0.0.1') {
    throw new Error('MCP endpoint must use HTTPS');
  }
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Authorization': `Bearer ${MCP_TOKEN}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
  const payload = response.headers.get('content-type')?.includes('text/event-stream') ? responseTextFromSse(text) : JSON.parse(text);
  if (payload.error) throw new Error(payload.error.message || `MCP error calling ${name}`);
  return payload.result || payload;
}

function resultData(result) {
  if (!result) return null;
  if (result.structuredContent && Object.prototype.hasOwnProperty.call(result.structuredContent, 'data')) return result.structuredContent.data;
  if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  const text = result.content?.find(item => item.type === 'text')?.text || '';
  const marker = '## Original Response\\n\\n';
  const index = text.lastIndexOf(marker);
  if (index >= 0) {
    try { return JSON.parse(text.slice(index + marker.length)).data; } catch { /* keep source text */ }
  }
  return text || null;
}

function unwrapData(result) {
  return resultData(result);
}

async function attemptTools(calls) {
  const results = {};
  const errors = {};
  await Promise.all(calls.map(async call => {
    const [name, args] = Array.isArray(call) ? call : [call, {}];
    try { results[name] = await mcpCall(name, args); }
    catch (err) { errors[name] = err.message; }
  }));
  return { results, errors };
}

function hasResult(result) { return Object.keys(result).length > 0; }

async function apiHealth(_req, res) {
  sendJson(res, 200, { ok: true, service: 'mcd-mcp-demo-proxy', mcpConfigured: Boolean(MCP_TOKEN), isDemo: !MCP_TOKEN, timestamp: new Date().toISOString() });
}

async function apiActivity(_req, res) {
  const { results, errors } = await attemptTools([['campaign-calendar', {}]]);
  const liveData = unwrapData(results['campaign-calendar']);
  const live = Boolean(liveData);
  sendJson(res, 200, { isDemo: !live, data: live ? { campaigns: liveData } : DEMO_ACTIVITY, ...(live ? {} : { fallbackReason: MCP_TOKEN ? 'MCP activity tool unavailable; showing demo data.' : 'MCD_MCP_TOKEN is not configured; showing demo data.' }), ...(Object.keys(errors).length ? { toolErrors: errors } : {}) });
}

async function apiNutrition(_req, res) {
  const { results, errors } = await attemptTools([['list-nutrition-foods', {}]]);
  const liveData = unwrapData(results['list-nutrition-foods']);
  const live = Boolean(liveData);
  sendJson(res, 200, { isDemo: !live, data: live ? { foods: liveData } : DEMO_NUTRITION, ...(live ? {} : { fallbackReason: MCP_TOKEN ? 'MCP nutrition tool unavailable; showing demo data.' : 'MCD_MCP_TOKEN is not configured; showing demo data.' }), ...(Object.keys(errors).length ? { toolErrors: errors } : {}) });
}

function catalogRows(menuData) {
  if (!menuData || typeof menuData !== 'object') return [];
  const meals = menuData.meals || {};
  return Object.entries(meals).map(([code, item]) => ({
    code, name: item.name || item.productName || code,
    price: Number(item.currentPrice ?? item.price ?? NaN),
    tags: item.tags || []
  }));
}

function matchMeal(rows, patterns, fallbackPattern) {
  for (const pattern of patterns) {
    const found = rows.find(row => pattern.test(row.name));
    if (found) return found;
  }
  return rows.find(row => fallbackPattern.test(row.name)) || rows.find(row => Number.isFinite(row.price)) || rows[0];
}

function nutritionLookup(data, name) {
  if (!data || typeof data !== 'string') return null;
  const lines = data.split(/\r?\n/);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = lines.find(row => new RegExp(`^\\s*${escaped},`).test(row));
  if (!line) return null;
  const kcal = Number(line.split(',')[3]);
  return Number.isFinite(kcal) ? kcal : null;
}

function buildCandidate(id, seat, title, tagline, reason, items, nutritionData) {
  const calories = items.map(item => nutritionLookup(nutritionData, item.name));
  return {
    id, seat, title, tagline, items: items.map(item => item.name),
    productCodes: items.map(item => ({ productCode: item.code, quantity: 1 })),
    estimatedCaloriesKcal: calories.every(Number.isFinite) ? calories.reduce((sum, value) => sum + value, 0) : null,
    estimatedPriceCny: items.every(item => Number.isFinite(item.price)) ? Number(items.reduce((sum, item) => sum + item.price, 0).toFixed(2)) : null,
    reason, priceSource: 'menu', voteLabel: `我站${seat}`
  };
}

async function apiChallenge(req, res) {
  const input = await readBody(req);
  const city = typeof input.city === 'string' && input.city.trim() ? input.city.trim().slice(0, 40) : '杭州';
  const keyword = typeof input.keyword === 'string' && input.keyword.trim() ? input.keyword.trim().slice(0, 60) : city;
  const vibe = typeof input.vibe === 'string' ? input.vibe.slice(0, 32) : 'focus';
  const budget = typeof input.budget === 'string' ? input.budget.slice(0, 24) : '25-40';
  const time = Number.isInteger(input.time) ? Math.max(5, Math.min(input.time, 180)) : 20;
  const partySize = Number.isInteger(input.partySize) ? Math.max(1, Math.min(input.partySize, 20)) : 1;
  const preferences = { city, vibe, budget, time, partySize, prefs: Array.isArray(input.prefs) ? input.prefs.filter(x => typeof x === 'string').slice(0, 8) : [] };
  const errors = {};
  if (!MCP_TOKEN) {
    return sendJson(res, 200, { isDemo: true, candidates: DEMO_CANDIDATES, preferences, fallbackReason: 'MCD_MCP_TOKEN is not configured; showing demo candidates.', notice: '此为演示候选，不是官方报价或营养建议。' });
  }

  const [activityResult, nutritionResult, storesResult] = await Promise.all([
    mcpCall('campaign-calendar', {}).catch(err => { errors['campaign-calendar'] = err.message; return null; }),
    mcpCall('list-nutrition-foods', {}).catch(err => { errors['list-nutrition-foods'] = err.message; return null; }),
    mcpCall('query-nearby-stores', { beType: 1, city, keyword, searchType: 2 }).catch(err => { errors['query-nearby-stores'] = err.message; return null; })
  ]);
  const activity = unwrapData(activityResult);
  const nutrition = unwrapData(nutritionResult);
  const storeData = unwrapData(storesResult);
  const store = Array.isArray(storeData) ? storeData.find(item => item.businessStatus !== false) || storeData[0] : null;
  let menuResult = null;
  let menuData = null;
  if (store?.storeCode) {
    try {
      menuResult = await mcpCall('query-meals', { storeCode: store.storeCode, orderType: 1, beType: 1 });
      menuData = unwrapData(menuResult);
    } catch (err) { errors['query-meals'] = err.message; }
  } else if (MCP_TOKEN && !errors['query-nearby-stores']) {
    errors['query-nearby-stores'] = 'No store returned for selected city and keyword';
  }

  const rows = catalogRows(menuData);
  let candidates = DEMO_CANDIDATES;
  let priceResults = {};
  if (rows.length) {
    const budgetMain = matchMeal(rows, [/麥香鸡|麦香鸡/, /吉士汉堡包/, /麦香鱼/], /单人餐|套餐/);
    const budgetSide = matchMeal(rows, [/玉米杯/, /苹果片/, /脆薯饼/], /小食/);
    const noveltyMain = matchMeal(rows, [/龙焰鸡腿堡/, /“我就喜欢”鸡薯双全盒/, /心形薯饼/], /上新/);
    const noveltySide = matchMeal(rows, [/蓝莓爆爆珠麦旋风/, /麦旋风/, /圆筒冰淇淋/], /新品|上新/);
    const momentMain = matchMeal(rows, [/板烧鸡腿堡/, /精选单人餐/, /麦辣鸡腿汉堡/], /汉堡|鸡/);
    const momentSide = matchMeal(rows, [/玉米杯/, /小杯玉米杯/, /锡兰红茶/], /饮品|小食/);
    const nutritionData = typeof nutrition === 'string' ? nutrition : (nutrition?.data || '');
    candidates = [
      buildCandidate('seat-budget', '预算席', '够吃就好，不为选择交税', '预算派 / 把钱花在主食上', '同一份门店菜单里先把预算说清楚：用真实在售商品拼出不绕弯的答案。', [budgetMain, budgetSide].filter(Boolean), nutritionData),
      buildCandidate('seat-novelty', '尝鲜席', '今天就该试试新口味', '尝鲜派 / 把新品变成理由', '让当期活动和门店上新一起说话，找一个“今天才成立”的去麦理由。', [noveltyMain, noveltySide].filter(Boolean), nutritionData),
      buildCandidate('seat-moment', '此刻席', '别再开会，去吃点热的', '此刻派 / 让时间与心情做决定', `${city} · ${time} 分钟 · ${partySize} 人：把这个具体时刻变成一份马上能选的菜单。`, [momentMain, momentSide].filter(Boolean), nutritionData)
    ];
    await Promise.all(candidates.map(async candidate => {
      try {
        const priced = await mcpCall('calculate-price', { storeCode: store.storeCode, orderType: 1, beType: 1, items: candidate.productCodes, needTableware: false });
        const data = unwrapData(priced);
        if (data && Number.isFinite(Number(data.price))) {
          candidate.estimatedPriceCny = Number((Number(data.price) / 100).toFixed(2));
          candidate.originalPriceCny = Number.isFinite(Number(data.originalPrice)) ? Number((Number(data.originalPrice) / 100).toFixed(2)) : candidate.estimatedPriceCny;
          candidate.discountCny = Number.isFinite(Number(data.discount)) ? Number((Number(data.discount) / 100).toFixed(2)) : 0;
          candidate.priceSource = 'calculate-price';
          priceResults[candidate.id] = data;
        }
      } catch (err) { errors['calculate-price:' + candidate.id] = err.message; }
    }));
  }
  const live = Boolean(store && rows.length);
  sendJson(res, 200, {
    isDemo: !live,
    candidates: live ? candidates : DEMO_CANDIDATES,
    preferences,
    sourceData: live ? {
      store: { storeName: store.storeName, address: store.address, storeCode: store.storeCode, distance: store.distance },
      menu: menuData,
      activity,
      nutrition: nutritionDataSummary(nutrition),
      priceResults
    } : { activity, nutrition: nutritionDataSummary(nutrition), stores: storeData },
    ...(live ? {} : { fallbackReason: 'Live store/menu data unavailable; showing clearly marked demo candidates.' }),
    ...(Object.keys(errors).length ? { toolErrors: errors } : {}),
    notice: '商品与活动来自麦当劳 MCP；价格经门店价格计算工具返回（未创建订单）。营养数据仅作信息参考，具体以门店实际为准。'
  });
}

function nutritionDataSummary(data) {
  if (!data) return null;
  if (typeof data === 'string') return { raw: data.slice(0, 12000) };
  return data;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

function serveStatic(req, res, urlPath) {
  let pathname;
  try { pathname = decodeURIComponent(urlPath); } catch { return sendJson(res, 400, { error: 'Invalid path' }); }
  if (pathname === '/') pathname = '/index.html';
  const file = path.resolve(ROOT, `.${pathname}`);
  if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, 'index.html')) return sendJson(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': stat.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') return await apiHealth(req, res);
    if (req.method === 'GET' && url.pathname === '/api/activity') return await apiActivity(req, res);
    if (req.method === 'GET' && url.pathname === '/api/nutrition') return await apiNutrition(req, res);
    if (req.method === 'POST' && url.pathname === '/api/challenge') return await apiChallenge(req, res);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'API route not found' });
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
    return sendJson(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    sendJson(res, err.statusCode || 500, { error: err.statusCode === 400 ? err.message : 'Request failed', isDemo: true });
  }
});

server.listen(PORT, HOST, () => console.log(`MCD demo proxy listening on http://${HOST}:${PORT}`));
