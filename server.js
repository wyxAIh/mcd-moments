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

function responseTextFromSse(text, requestId) {
  const dataLines = text.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
  for (let i = dataLines.length - 1; i >= 0; i--) {
    if (!dataLines[i] || dataLines[i] === '[DONE]') continue;
    let event;
    try { event = JSON.parse(dataLines[i]); } catch { continue; }
    if (event.id !== undefined && String(event.id) !== String(requestId)) continue;
    if (event.error) throw new Error(event.error.message || 'MCP returned an error');
    if (Object.prototype.hasOwnProperty.call(event, 'result')) return event;
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
  return Object.prototype.hasOwnProperty.call(payload, 'result') ? payload.result : payload;
}

function resultData(result) {
  if (!result) return null;
  if (result.structuredContent && Object.prototype.hasOwnProperty.call(result.structuredContent, 'data')) return result.structuredContent.data;
  if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
  const text = result.content?.find(item => item.type === 'text')?.text || '';
  const marker = '## Original Response';
  const index = text.lastIndexOf(marker);
  if (index >= 0) {
    const raw = text.slice(index + marker.length).trim();
    try {
      const parsed = JSON.parse(raw);
      return Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed;
    } catch { /* continue to plain JSON parsing */ }
  }
  try {
    const parsed = JSON.parse(text);
    return Object.prototype.hasOwnProperty.call(parsed, 'data') ? parsed.data : parsed;
  } catch { return text || null; }
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
  sendJson(res, 200, { ok: true, service: 'mcd-mcp-demo-proxy', mcpConfigured: Boolean(MCP_TOKEN), liveRequired: true, isDemo: !MCP_TOKEN, timestamp: new Date().toISOString() });
}

async function apiActivity(_req, res) {
  if (!MCP_TOKEN) return sendJson(res, 503, { isDemo: false, error: 'LIVE_MCP_NOT_CONFIGURED', message: '服务器尚未配置麦当劳 MCP Token，无法返回实时活动。' });
  const { results, errors } = await attemptTools([['campaign-calendar', {}]]);
  const liveData = unwrapData(results['campaign-calendar']);
  if (!liveData) return sendJson(res, 502, { isDemo: false, error: 'LIVE_ACTIVITY_UNAVAILABLE', message: 'MCP 未返回实时活动。', toolErrors: errors });
  sendJson(res, 200, { isDemo: false, data: { campaigns: liveData }, toolErrors: errors });
}

async function apiNutrition(_req, res) {
  if (!MCP_TOKEN) return sendJson(res, 503, { isDemo: false, error: 'LIVE_MCP_NOT_CONFIGURED', message: '服务器尚未配置麦当劳 MCP Token，无法返回实时营养数据。' });
  const { results, errors } = await attemptTools([['list-nutrition-foods', {}]]);
  const liveData = unwrapData(results['list-nutrition-foods']);
  if (!liveData) return sendJson(res, 502, { isDemo: false, error: 'LIVE_NUTRITION_UNAVAILABLE', message: 'MCP 未返回实时营养数据。', toolErrors: errors });
  sendJson(res, 200, { isDemo: false, data: { foods: liveData }, toolErrors: errors });
}

function findMenuCollection(value, depth = 0) {
  if (!value || depth > 5 || typeof value !== 'object') return null;
  const keys = ['meals', 'products', 'items', 'foodList', 'mealList', 'menuItems', 'menu'];
  for (const key of keys) {
    if (Array.isArray(value[key]) || (value[key] && typeof value[key] === 'object')) return { collection: value[key], parent: value };
  }
  for (const child of Object.values(value)) {
    const found = findMenuCollection(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function categoryTags(menuData) {
  const tagsByCode = new Map();
  const categories = Array.isArray(menuData?.categories) ? menuData.categories : [];
  for (const category of categories) {
    const entries = Array.isArray(category?.meals)
      ? category.meals
      : category?.meals && typeof category.meals === 'object'
        ? Object.entries(category.meals).map(([code, value]) => ({ code, ...(value || {}) }))
        : [];
    for (const entry of entries) {
      const code = entry.productCode || entry.productId || entry.code;
      if (!code) continue;
      const existing = tagsByCode.get(String(code)) || [];
      const entryTags = Array.isArray(entry.tags) ? entry.tags : typeof entry.tags === 'string' ? [entry.tags] : [];
      tagsByCode.set(String(code), [...new Set([...existing, category.name, ...entryTags].filter(Boolean))]);
    }
  }
  return tagsByCode;
}

function catalogRows(menuData) {
  if (!menuData || typeof menuData !== 'object') return [];
  const found = findMenuCollection(menuData);
  const meals = found?.collection || {};
  const tagsByCode = categoryTags(menuData);
  const entries = Array.isArray(meals) ? meals.map((item, index) => [item.productCode || item.productId || item.code || String(index), item]) : Object.entries(meals);
  return entries.map(([code, item]) => {
    if (!item || typeof item !== 'object') return null;
    const rawPrice = Number(item.currentPrice ?? item.price ?? item.salePrice ?? item.amount ?? item.totalPrice ?? NaN);
    const priceUnit = String(item.priceUnit || item.currencyUnit || '').toLowerCase();
    const price = Number.isFinite(rawPrice) && ['fen', '分', 'cent'].includes(priceUnit) ? rawPrice / 100 : rawPrice;
    const rowCode = String(item.productCode || item.productId || item.code || code);
    const itemTags = Array.isArray(item.tags) ? item.tags : typeof item.tags === 'string' ? [item.tags] : [];
    return {
      code: rowCode,
      name: item.name || item.productName || item.mealName || item.title || code,
      price,
      tags: [...new Set([...itemTags, ...(tagsByCode.get(rowCode) || [])])],
      raw: item
    };
  }).filter(row => row && row.code && row.name);
}

function numericPrice(data) {
  if (!data || typeof data !== 'object') return null;
  const value = Number(data.price);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function matchMeal(rows, patterns, excluded = new Set(), allowFallback = true) {
  const available = rows.filter(row => !excluded.has(row.code) && Number.isFinite(row.price) && row.price >= 0);
  for (const pattern of patterns) {
    const found = available.filter(row => pattern.test(`${row.name} ${row.tags.join(' ')}`)).sort((a, b) => a.price - b.price)[0];
    if (found) return found;
  }
  return allowFallback ? available.sort((a, b) => a.price - b.price)[0] || null : null;
}

function budgetBounds(budget) {
  return ({ '25-40': { min: 25, max: 40, label: '¥25—40/人' }, '40-60': { min: 40, max: 60, label: '¥40—60/人' }, '60-plus': { min: 60, max: Number.POSITIVE_INFINITY, label: '¥60+/人' } })[budget] || { min: 25, max: 40, label: '¥25—40/人' };
}

function budgetMaximum(budget) { return budgetBounds(budget).max; }

function rowText(row) { return `${row.name} ${row.tags.join(' ')}`; }
function isSetMeal(row) { return /套餐|三件套|单人餐|双人餐|多人餐|拼盘|分享|便民套餐|精选餐/i.test(rowText(row)); }
function isShareMeal(row) { return /分享|多人|双人|家庭|拼盘|鸡薯双全盒/i.test(rowText(row)); }
function isPrimaryMeal(row) { return isSetMeal(row) || /汉堡|鸡肉|牛肉|猪柳|麦香鱼|麦乐鸡|鸡翅|鸡排|主食/i.test(rowText(row)); }
function isSideMeal(row) { return /玉米|苹果|沙拉|薯条|饮品|小食|茶|水|麦旋风|冰淇淋|派|脆薯饼|麦咖啡|雪碧|可乐|美汁源|红茶/i.test(rowText(row)); }
function isNovelty(row) { return /上新|新品|限定|联名|季节|新口味|蓝莓|龙焰|心形/i.test(rowText(row)); }

function productQuantity(row, partySize) {
  const text = rowText(row);
  if (/双人餐|双人分享|二人/i.test(text)) return Math.max(1, Math.ceil(partySize / 2));
  if (/分享|多人|家庭|拼盘|桶|鸡薯双全盒/i.test(text)) return Math.max(1, Math.ceil(partySize / 3));
  return partySize;
}

function budgetTarget(budget) {
  const bounds = budgetBounds(budget);
  if (!Number.isFinite(bounds.max)) return Math.max(bounds.min, 60);
  return bounds.min + (bounds.max - bounds.min) * 0.65;
}

function preferenceSideRows(rows, prefs) {
  let sides = rows.filter(isSideMeal);
  if (prefs.includes('light')) {
    const lightOptions = sides.filter(row => /玉米|苹果|沙拉|茶|水|无糖|零度|清爽/i.test(rowText(row)));
    if (lightOptions.length) sides = lightOptions;
  }
  if (prefs.includes('sugar')) {
    const lowerSugarOptions = sides.filter(row => /水|无糖|零度|茶|苹果|玉米|沙拉/i.test(rowText(row)));
    if (lowerSugarOptions.length) sides = lowerSugarOptions;
  }
  return sides;
}

function estimateSpecPerPerson(items, partySize) {
  return items.reduce((sum, row) => sum + row.price * productQuantity(row, partySize), 0) / partySize;
}

function specKey(items, partySize) {
  return items.map(row => `${row.code}:${productQuantity(row, partySize)}`).sort().join('|');
}

function buildSeatSpecs({ seat, rows, budget, time, partySize, prefs, vibe }) {
  const { max } = budgetBounds(budget);
  const mains = rows.filter(isPrimaryMeal);
  const sides = preferenceSideRows(rows, prefs);
  const setMeals = mains.filter(isSetMeal);
  const singles = mains.filter(row => !isSetMeal(row));
  const noveltyRows = rows.filter(isNovelty);
  const specs = [];
  const push = (items, priority = 0) => {
    if (!items.length || items.length > 2) return;
    const perPerson = estimateSpecPerPerson(items, partySize);
    if (!Number.isFinite(perPerson) || perPerson < 0 || perPerson > max) return;
    specs.push({ items, perPerson, priority });
  };

  if (seat === 'budget') {
    for (const meal of setMeals) push([meal], 4);
    for (const main of singles) {
      push([main], 0);
      for (const side of sides) {
        if (side.code === main.code) continue;
        push([main, side], prefs.includes('full') ? 5 : 2);
      }
    }
    if (prefs.includes('share')) for (const meal of setMeals.filter(isShareMeal)) push([meal], 10);
  } else if (seat === 'novelty') {
    const noveltyMains = noveltyRows.filter(isPrimaryMeal);
    const noveltySides = noveltyRows.filter(row => isSideMeal(row) && !isPrimaryMeal(row));
    for (const main of noveltyMains) {
      if (isSetMeal(main)) push([main], 8);
      else {
        push([main], 2);
        for (const side of sides) if (side.code !== main.code) push([main, side], isNovelty(side) ? 10 : 4);
      }
    }
    const vibeMain = mains.filter(row => !isSetMeal(row)).sort((a, b) => {
      const pattern = vibe === 'family' ? /儿童|家庭|分享|盒/i : vibe === 'friends' ? /分享|多人|双人|盒/i : vibe === 'recharge' ? /板烧|鸡肉|牛肉/i : /汉堡|精选|人气/i;
      return Number(pattern.test(rowText(b))) - Number(pattern.test(rowText(a)));
    });
    for (const main of vibeMain) for (const side of noveltySides.length ? noveltySides : sides) push([main, side], noveltySides.length ? 10 : 1);
    for (const meal of setMeals.filter(isNovelty)) push([meal], 12);
  } else {
    const vibePattern = vibe === 'family' ? /儿童|家庭|分享|多人|双人|盒|拼盘/i
      : vibe === 'friends' ? /分享|多人|双人|盒|拼盘/i
        : vibe === 'recharge' ? /板烧|鸡肉|牛肉|主食/i
          : /汉堡|精选|人气|主食/i;
    const shareMains = prefs.includes('share') ? mains.filter(isShareMeal) : [];
    const orderedMains = [...new Set([...shareMains, ...mains.filter(row => vibePattern.test(rowText(row))), ...mains])];
    for (const main of orderedMains) {
      if (isSetMeal(main)) push([main], prefs.includes('share') && isShareMeal(main) ? 12 : 7);
      else {
        push([main], 1);
        for (const side of sides) if (side.code !== main.code) push([main, side], 4);
      }
    }
  }

  const unique = new Map();
  for (const spec of specs) {
    const key = specKey(spec.items, partySize);
    const existing = unique.get(key);
    if (!existing || spec.priority > existing.priority) unique.set(key, spec);
  }
  const timePreference = spec => {
    const oneCode = spec.items.length === 1;
    if (time <= 20) return oneCode ? 3 : 0;
    if (time >= 60) return oneCode ? 0 : 2;
    return oneCode ? 1 : 0;
  };
  const target = budgetTarget(budget);
  return [...unique.values()].sort((a, b) => {
    const shareBonus = spec => prefs.includes('share') && spec.items.some(isShareMeal) ? 8 : 0;
    const fullBonus = spec => prefs.includes('full') ? (spec.items.length > 1 || spec.items.some(isSetMeal) ? 3 : 0) : 0;
    const aScore = a.priority + timePreference(a) + shareBonus(a) + fullBonus(a) - Math.abs(a.perPerson - target) / 10;
    const bScore = b.priority + timePreference(b) + shareBonus(b) + fullBonus(b) - Math.abs(b.perPerson - target) / 10;
    return bScore - aScore;
  });
}

function makeSeatCandidate({ id, seat, title, tagline, items, preferences, partySize, reason }) {
  const selected = items.filter(Boolean);
  const productCodes = selected.map(item => ({ productCode: item.code, quantity: productQuantity(item, partySize) }));
  const estimatedPriceCny = Number(selected.reduce((sum, item, index) => sum + item.price * productCodes[index].quantity, 0).toFixed(2));
  return {
    id, seat, title, tagline, items: selected.map(item => item.name), productCodes,
    estimatedPriceCny, estimatedPricePerPersonCny: Number((estimatedPriceCny / partySize).toFixed(2)),
    estimatedCaloriesKcal: null, reason, priceSource: 'menu', voteLabel: `我站${seat}`,
    tools: ['campaign-calendar', 'list-nutrition-foods', 'query-nearby-stores', 'query-meals', 'calculate-price'],
    preferences
  };
}

function candidateReason({ vibeText, time, partySize, budget, pricePerPerson, prefs, items, seat }) {
  const budgetLabel = { '25-40': '¥25—40/人', '40-60': '¥40—60/人', '60-plus': '¥60+/人' }[budget] || '自定预算';
  const preferenceLabel = { light: '清爽', full: '饱腹', sugar: '少糖/无糖', share: '适合分享' };
  const preferenceText = prefs.length ? `；偏好：${prefs.map(pref => preferenceLabel[pref] || pref).join('、')}` : '';
  const priceText = Number.isFinite(pricePerPerson) ? `约 ¥${pricePerPerson.toFixed(2)}/人` : '价格以实时计算结果为准';
  return `${vibeText} · ${time} 分钟 · ${partySize} 人 · 预算 ${budgetLabel}；${seat}推荐 ${items.map(item => item.name).join(' + ')}，${priceText}${preferenceText}。`;
}

function amountYuanFromFen(value) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 0 ? Number((amount / 100).toFixed(2)) : null;
}

function matchesPricedItems(priceData, productCodes) {
  if (!Array.isArray(priceData?.productList) || !priceData.productList.length) return false;
  const expected = new Map();
  const actual = new Map();
  for (const item of productCodes) expected.set(String(item.productCode), (expected.get(String(item.productCode)) || 0) + Number(item.quantity));
  for (const item of priceData.productList) {
    if (!item?.productCode || !Number.isFinite(Number(item.quantity))) continue;
    const code = String(item.productCode);
    actual.set(code, (actual.get(code) || 0) + Number(item.quantity));
  }
  return expected.size === actual.size && [...expected].every(([code, quantity]) => actual.get(code) === quantity);
}

async function apiChallenge(req, res) {
  const input = await readBody(req);
  const city = typeof input.city === 'string' && input.city.trim() ? input.city.trim().slice(0, 40) : '杭州';
  const keyword = typeof input.keyword === 'string' && input.keyword.trim() ? input.keyword.trim().slice(0, 60) : city;
  const vibe = ['focus', 'friends', 'recharge', 'family'].includes(input.vibe) ? input.vibe : 'focus';
  const budget = ['25-40', '40-60', '60-plus'].includes(input.budget) ? input.budget : '25-40';
  const time = Number.isInteger(input.time) ? Math.max(5, Math.min(input.time, 180)) : 20;
  const partySize = Number.isInteger(input.partySize) ? Math.max(1, Math.min(input.partySize, 8)) : 1;
  const prefs = Array.isArray(input.prefs) ? input.prefs.filter(x => ['light', 'full', 'sugar', 'share'].includes(x)).slice(0, 8) : [];
  const vibeLabels = { focus: '赶稿冲刺', friends: '见朋友', recharge: '一个人回血', family: '带娃出门' };
  const preferences = { city, vibe, vibeText: vibeLabels[vibe], budget, time, partySize, prefs };
  if (!MCP_TOKEN) {
    return sendJson(res, 503, { isDemo: false, error: 'LIVE_MCP_NOT_CONFIGURED', message: '服务器尚未配置麦当劳 MCP Token，无法返回实时菜单或价格。', preferences });
  }

  const toolStatus = {};
  const errors = {};
  const call = async (name, args = {}) => {
    try {
      const raw = await mcpCall(name, args);
      toolStatus[name] = { status: 'ok' };
      return unwrapData(raw);
    } catch (err) {
      errors[name] = err.message;
      toolStatus[name] = { status: 'error', message: err.message };
      return null;
    }
  };
  const [activity, nutrition, storeData] = await Promise.all([
    call('campaign-calendar'),
    call('list-nutrition-foods'),
    call('query-nearby-stores', { beType: 1, city, keyword, searchType: 2 })
  ]);
  const storeRows = Array.isArray(storeData)
    ? storeData
    : Array.isArray(storeData?.stores)
      ? storeData.stores
      : Array.isArray(storeData?.data)
        ? storeData.data
        : Array.isArray(storeData?.list)
          ? storeData.list
          : [];
  const store = storeRows.find(item => item.businessStatus !== false) || storeRows[0] || null;
  if (!store?.storeCode) {
    return sendJson(res, 502, { isDemo: false, error: 'LIVE_STORE_UNAVAILABLE', message: 'MCP 未返回可用门店，本次没有生成演示冒充的实时推荐。请确认城市/关键词后重试。', preferences, toolStatus, toolErrors: errors });
  }
  const menuData = await call('query-meals', { storeCode: store.storeCode, orderType: 1, beType: 1 });
  const rows = catalogRows(menuData).filter(row => Number.isFinite(row.price) && row.price >= 0);
  if (!rows.length) {
    return sendJson(res, 502, { isDemo: false, error: 'LIVE_MENU_UNAVAILABLE', message: '已找到门店，但 MCP 未返回可用于筛选的实时菜单，本次未使用固定样例替代。', preferences, toolStatus, toolErrors: errors });
  }

  const usable = rows.filter(row => row.price > 0);
  const budgetLabel = budgetBounds(budget).label;
  const partyTitle = partySize > 1 ? `${partySize} 人同行` : '一个人';
  const activityRows = Array.isArray(activity) ? activity : Array.isArray(activity?.campaigns) ? activity.campaigns : Array.isArray(activity?.data) ? activity.data : [];
  const activityText = activityRows.slice(0, 2).map(item => item.title || item.name).filter(Boolean).join('、');
  const seatConfigs = [
    { id: 'seat-budget', seat: '预算席', kind: 'budget', title: `${budgetLabel}内，先把这一餐安排稳`, tagline: `实时菜单 · 人均预算 ${budgetLabel}` },
    { id: 'seat-novelty', seat: '尝鲜席', kind: 'novelty', title: '从当前门店菜单里换个口味', tagline: activityText ? `当期活动：${activityText}` : '按本店实时菜单寻找不同选择' },
    { id: 'seat-moment', seat: '此刻席', kind: 'moment', title: `${vibeLabels[vibe]} · ${time} 分钟的这一餐`, tagline: `${partyTitle} · ${budgetLabel} · 按此刻需求筛选` }
  ];
  const candidates = [];
  const selectedSpecKeys = new Set();
  for (const config of seatConfigs) {
    const specs = buildSeatSpecs({ seat: config.kind, rows: usable, budget, time, partySize, prefs, vibe });
    const spec = specs.find(option => !selectedSpecKeys.has(specKey(option.items, partySize))) || specs[0];
    if (!spec) {
      return sendJson(res, 502, { isDemo: false, error: 'LIVE_NO_BUDGET_OPTIONS', message: `${config.seat}未找到符合 ${budgetLabel} 的实时菜单组合，本次不使用固定样例补位。`, preferences, toolStatus, toolErrors: errors });
    }
    selectedSpecKeys.add(specKey(spec.items, partySize));
    const title = config.kind === 'novelty' && spec.items[0] ? `用「${spec.items[0].name}」给今天一个新理由` : config.title;
    candidates.push(makeSeatCandidate({ id: config.id, seat: config.seat, title, tagline: config.tagline, reason: '', items: spec.items, preferences, partySize, vibe }));
  }
  const priceResults = {};
  await Promise.all(candidates.map(async candidate => {
    try {
      const priced = await mcpCall('calculate-price', { storeCode: store.storeCode, orderType: 1, beType: 1, items: candidate.productCodes, needTableware: false });
      const data = unwrapData(priced);
      const rawPrice = numericPrice(data);
      if (!Number.isInteger(rawPrice)) throw new Error('MCP 未返回整数分的应付总价');
      if (!matchesPricedItems(data, candidate.productCodes)) throw new Error('MCP 返回的商品明细与本方案不一致');
      const priceInYuan = amountYuanFromFen(rawPrice);
      if (priceInYuan === null) throw new Error('MCP 返回的价格不是有效分金额');
      candidate.estimatedPriceCny = priceInYuan;
      candidate.estimatedPricePerPersonCny = Number((priceInYuan / partySize).toFixed(2));
      const originalPriceCny = amountYuanFromFen(data.originalPrice);
      const discountCny = amountYuanFromFen(data.discount);
      candidate.originalPriceCny = originalPriceCny === null ? priceInYuan : originalPriceCny;
      candidate.discountCny = discountCny === null ? 0 : discountCny;
      candidate.priceSource = 'calculate-price';
      priceResults[candidate.id] = data;
      toolStatus[`calculate-price:${candidate.id}`] = { status: 'ok' };
    } catch (err) {
      errors[`calculate-price:${candidate.id}`] = err.message;
      toolStatus[`calculate-price:${candidate.id}`] = { status: 'error', message: err.message };
      candidate.priceSource = 'menu';
    }
  }));
  const allPricesLive = candidates.every(candidate => candidate.priceSource === 'calculate-price');
  if (!allPricesLive) {
    return sendJson(res, 502, { isDemo: false, error: 'LIVE_PRICE_UNAVAILABLE', message: '菜单已实时读取，但至少一个方案的价格未能通过 MCP 价格工具确认；为避免把菜单估算冒充实价，本次不展示候选。', preferences, toolStatus, toolErrors: errors });
  }
  const maxPerPerson = budgetMaximum(budget);
  const overBudget = candidates.filter(candidate => Number.isFinite(maxPerPerson) && candidate.estimatedPricePerPersonCny > maxPerPerson);
  if (overBudget.length) {
    const names = overBudget.map(candidate => candidate.seat).join('、');
    return sendJson(res, 502, { isDemo: false, error: 'LIVE_BUDGET_REJECTED', message: `${names}的 MCP 核价超过 ${budgetLabel} 上限，本次不展示超预算方案。`, preferences, toolStatus, toolErrors: errors });
  }
  candidates.forEach(candidate => {
    const items = candidate.productCodes.map(item => rows.find(row => row.code === String(item.productCode))).filter(Boolean);
    candidate.reason = candidateReason({ vibeText: vibeLabels[vibe], time, partySize, budget, pricePerPerson: candidate.estimatedPricePerPersonCny, prefs, items, seat: candidate.seat });
  });
  sendJson(res, 200, {
    isDemo: false, candidates, preferences, toolStatus,
    sourceData: { store: { storeName: store.storeName, address: store.address, storeCode: store.storeCode, distance: store.distance }, menu: menuData, activity, nutrition: nutritionDataSummary(nutrition), priceResults },
    notice: '门店、菜单、活动和价格来自本次麦当劳 MCP 读取；营养信息仅作参考。本服务不会创建订单或发起支付。'
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

if (require.main === module) {
  server.listen(PORT, HOST, () => console.log(`MCD demo proxy listening on http://${HOST}:${PORT}`));
}

module.exports = { server, catalogRows, budgetMaximum, budgetBounds, candidateReason, makeSeatCandidate, numericPrice };
