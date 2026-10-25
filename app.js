(() => {
  'use strict';

  const fallbackCandidates = [
    { id: 'seat-budget', seat: '预算席', title: '够吃就好，不为选择交税', tagline: '预算派 / 把钱花在主食上', items: ['麦香鸡', '玉米杯'], estimatedPriceCny: 33.5, estimatedCaloriesKcal: 422, reason: '先把预算说清楚：用门店菜单里真实在售的商品拼出不绕弯的答案。', tools: ['query-meals', 'calculate-price'] },
    { id: 'seat-novelty', seat: '尝鲜席', title: '今天就该试试新口味', tagline: '尝鲜派 / 把新品变成理由', items: ['龙焰鸡腿堡', '蓝莓爆爆珠麦旋风'], estimatedPriceCny: 43.5, estimatedCaloriesKcal: null, reason: '让当期活动和门店上新一起说话，找一个“今天才成立”的去麦理由。', tools: ['campaign-calendar', 'query-meals', 'calculate-price'] },
    { id: 'seat-moment', seat: '此刻席', title: '别再开会，去吃点热的', tagline: '此刻派 / 让时间与心情做决定', items: ['板烧鸡腿堡', '玉米杯'], estimatedPriceCny: 40.5, estimatedCaloriesKcal: 444, reason: '你只有 20 分钟、一个人赶稿：这份组合够直接，也不用把时间耗在选餐上。', tools: ['query-nearby-stores', 'query-meals', 'list-nutrition-foods', 'calculate-price'] }
  ];

  const toolMeta = [
    ['campaign-calendar', '活动与时段', '查看此刻可用活动'],
    ['list-nutrition-foods', '营养信息', '匹配能量与蛋白'],
    ['query-nearby-stores', '附近门店', '确认可执行的门店'],
    ['query-meals', '菜单候选', '筛选符合偏好的组合'],
    ['calculate-price', '价格与优惠', '计算预算内的实际价格']
  ];

  const state = {
    vibe: 'focus', budget: '25-40', time: 20, partySize: 1, prefs: new Set(),
    candidates: fallbackCandidates.map(item => ({ ...item, items: [...item.items] })),
    selectedId: 'seat-moment', isDemo: true, isGenerating: false, logs: [], sourceData: null
  };

  const vibeText = { focus: '赶稿冲刺', friends: '见朋友', recharge: '一个人回血', family: '带娃出门' };
  const vibeReasons = {
    focus: '一个不打断节奏、却能让你重新有电的选择。',
    friends: '把选择交给分享，把时间留给真正的见面。',
    recharge: '今天不需要一个宏大的奖励，一口刚刚好的安静就够了。',
    family: '大人小孩都能参与的轻松一餐，快乐不需要排练。'
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const form = $('#moment-form');
  const recommendations = $('#recommendations');
  const consoleLog = $('#console-log');
  const toast = $('#toast');
  let toastTimer;

  function safeText(value, fallback = '') { return value === null || value === undefined || value === '' ? fallback : String(value); }
  function escapeHTML(value) { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
  function formatPrice(value) { return value === null || value === undefined || Number.isNaN(Number(value)) ? '¥—' : `¥${Number(value).toFixed(Number(value) % 1 ? 1 : 0)}`; }
  function formatStat(value, suffix) { return value === null || value === undefined || value === '' || Number.isNaN(Number(value)) ? `— ${suffix}` : `${Number(value).toFixed(0)} ${suffix}`; }
  function formatTime() { return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  function showToast(message) { if (!toast) return; toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800); }

  function setRadioState(button, selected) { button.classList.toggle('is-selected', selected); button.setAttribute('aria-checked', selected ? 'true' : 'false'); }
  function updateMomentContext() { const context = $('#result-context'); if (context) context.textContent = `${vibeText[state.vibe]} · ${state.time} MIN · ${state.partySize} 人`; }
  function updateParty(delta) { state.partySize = Math.max(1, Math.min(8, state.partySize + delta)); const output = $('#party-count'); if (output) output.textContent = String(state.partySize); updateMomentContext(); }

  function setupInputs() {
    $$('[data-field]').forEach(button => button.addEventListener('click', () => {
      const field = button.dataset.field;
      state[field] = field === 'time' ? Number(button.dataset.value) : button.dataset.value;
      $$(`[data-field="${field}"]`).forEach(item => setRadioState(item, item === button));
      updateMomentContext();
    }));
    $$('[data-pref]').forEach(button => button.addEventListener('click', () => {
      const pref = button.dataset.pref;
      if (state.prefs.has(pref)) state.prefs.delete(pref); else state.prefs.add(pref);
      button.setAttribute('aria-pressed', state.prefs.has(pref) ? 'true' : 'false');
      button.classList.toggle('is-selected', state.prefs.has(pref));
    }));
    $('#party-minus')?.addEventListener('click', () => updateParty(-1));
    $('#party-plus')?.addEventListener('click', () => updateParty(1));
  }

  function normalizeCandidate(candidate, index) {
    const fallback = fallbackCandidates[index % fallbackCandidates.length];
    const items = Array.isArray(candidate?.items) && candidate.items.length ? candidate.items : fallback.items;
    return {
      ...fallback,
      ...candidate,
      id: safeText(candidate?.id, fallback.id),
      seat: safeText(candidate?.seat, fallback.seat),
      title: safeText(candidate?.title, fallback.title),
      tagline: safeText(candidate?.tagline, fallback.tagline),
      reason: safeText(candidate?.reason, fallback.reason),
      items: items.map(item => typeof item === 'string' ? item : safeText(item?.name || item?.title, '推荐单品')),
      estimatedPriceCny: candidate?.estimatedPriceCny ?? candidate?.price ?? fallback.estimatedPriceCny,
      estimatedCaloriesKcal: candidate?.estimatedCaloriesKcal ?? candidate?.calories ?? fallback.estimatedCaloriesKcal,
      discountCny: candidate?.discountCny ?? candidate?.saving ?? 0,
      tools: Array.isArray(candidate?.tools) && candidate.tools.length ? candidate.tools : fallback.tools
    };
  }

  function candidateCard(candidate, index) {
    const winner = state.selectedId === candidate.id;
    const toolList = candidate.tools.slice(0, 5).map(tool => `<span>${escapeHTML(tool)}</span>`).join('');
    const itemList = candidate.items.slice(0, 4).map(item => `<li>${escapeHTML(item)}</li>`).join('');
    const priceSource = candidate.priceSource === 'calculate-price' ? '实时价格' : '演示估算';
    return `<article class="recommendation-card${winner ? ' is-winner' : ''}" data-candidate-id="${escapeHTML(candidate.id)}">
      <div class="rec-seat" aria-hidden="true">${String(index + 1).padStart(2, '0')}</div>
      <div class="rec-content">
        <div class="rec-kicker">${escapeHTML(candidate.seat)} · ${index === 0 ? '当前优先' : '另一种答案'}</div>
        <h3>${escapeHTML(candidate.title)}</h3>
        <p>${escapeHTML(candidate.tagline)}</p>
        <ul class="rec-items">${itemList}</ul>
        <div class="rec-meta"><span><strong>${formatStat(candidate.estimatedCaloriesKcal, 'kcal')}</strong></span><span>${priceSource}</span>${Number(candidate.discountCny) > 0 ? `<span>省 ${formatPrice(candidate.discountCny)}</span>` : ''}</div>
      </div>
      <div class="rec-action"><div class="rec-price">${formatPrice(candidate.estimatedPriceCny)} <small>起</small></div><button class="vote-button" type="button" data-vote="${escapeHTML(candidate.id)}">${winner ? '已选这席' : '我选这席'}</button></div>
      ${winner ? '<span class="vote-count">YOUR PICK</span>' : ''}
      <div class="card-detail"><p>${escapeHTML(candidate.reason)}</p><div class="tool-tags">${toolList}</div></div>
    </article>`;
  }

  function renderCandidates() {
    state.candidates = state.candidates.map(normalizeCandidate);
    if (!state.candidates.some(candidate => candidate.id === state.selectedId)) state.selectedId = state.candidates[0]?.id;
    if (recommendations) recommendations.innerHTML = state.candidates.map(candidateCard).join('');
    $$('[data-vote]', recommendations).forEach(button => button.addEventListener('click', () => {
      state.selectedId = button.dataset.vote;
      renderCandidates();
      const selected = state.candidates.find(candidate => candidate.id === state.selectedId);
      if (selected) { $('#reason-text').textContent = selected.reason; showToast(`已选择${selected.seat}：${selected.title}`); }
    }));
    $$('.expand-button', recommendations).forEach(button => button.addEventListener('click', () => {
      const card = button.closest('.recommendation-card');
      const expanded = card.classList.toggle('is-expanded');
      button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      button.querySelector('span').textContent = expanded ? '−' : '+';
    }));
    const selected = state.candidates.find(candidate => candidate.id === state.selectedId) || state.candidates[0];
    if (selected && $('#reason-text')) $('#reason-text').textContent = selected.reason;
    if ($('#pass-id')) $('#pass-id').textContent = `MOM—${String(Math.floor(Math.random() * 900) + 100)}`;
  }

  function appendLog(tool, status = 'ok', note = '') { const now = new Date(); const time = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`; state.logs.push({ tool, status, note, time }); if (state.logs.length > 10) state.logs.shift(); renderLogs(); }
  function renderLogs() {
    if (!consoleLog) return;
    consoleLog.innerHTML = state.logs.map(log => `<div class="log-line"><span class="log-time">${escapeHTML(log.time)}</span><span class="${log.status === 'error' ? 'log-error' : log.status === 'demo' ? 'log-demo' : 'log-ok'}">${log.status === 'error' ? 'ERR' : log.status === 'demo' ? 'DEMO' : 'OK'}</span><span>${escapeHTML(log.tool)}</span></div>`).join('');
  }
  function startLogs() { state.logs = []; toolMeta.forEach(([tool], index) => setTimeout(() => appendLog(tool, state.isDemo ? 'demo' : 'ok', state.isDemo ? 'fallback' : '200'), index * 90)); }

  function updateConsoleMode() {
    const stateEl = $('#console-state');
    const modeEl = $('#console-mode');
    const foot = $('#console-foot-text');
    const header = $('#header-status');
    if (stateEl) { stateEl.classList.toggle('is-live', !state.isDemo); stateEl.classList.toggle('is-error', false); const label = $('b', stateEl); if (label) label.textContent = state.isDemo ? 'DEMO DATA' : 'LIVE DATA'; }
    if (modeEl) modeEl.textContent = state.isDemo ? 'FALLBACK' : 'LIVE';
    if (foot) foot.textContent = state.isDemo ? '未能取到实时菜单，已切换至可演示数据' : '已收到 MCP 实时数据，未创建订单';
    if (header) header.textContent = state.isDemo ? 'MCP DEMO' : 'MCP LIVE';
    if ($('#tool-count')) $('#tool-count').textContent = String(toolMeta.length).padStart(2, '0');
  }

  async function fetchJSON(path, options = {}) { const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }
  async function requestRecommendations() {
    const payload = { city: '杭州', keyword: '杭州', vibe: state.vibe, goal: state.vibe, budget: state.budget, time: state.time, partySize: state.partySize, prefs: [...state.prefs], preferences: [...state.prefs] };
    try {
      const data = await fetchJSON('/api/challenge', { method: 'POST', body: JSON.stringify(payload) });
      if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('No candidates returned');
      state.candidates = data.candidates.map(normalizeCandidate);
      state.isDemo = Boolean(data.isDemo);
      state.sourceData = data.sourceData || null;
      return data;
    } catch (error) {
      state.candidates = fallbackCandidates.map(item => ({ ...item, items: [...item.items] }));
      state.isDemo = true;
      state.sourceData = null;
      return { isDemo: true, fallbackReason: error.message };
    }
  }

  function updateButtonLoading(isLoading) { const button = $('#generate-button'); if (!button) return; button.classList.toggle('is-loading', isLoading); button.setAttribute('aria-busy', isLoading ? 'true' : 'false'); button.disabled = isLoading; const label = $('.button-label', button); if (label) label.textContent = isLoading ? '正在拼出这一刻…' : '生成我的麦时刻'; }
  async function generateMoment({ scroll = true } = {}) {
    if (state.isGenerating) return;
    state.isGenerating = true; updateButtonLoading(true); startLogs();
    await new Promise(resolve => setTimeout(resolve, 260));
    const data = await requestRecommendations();
    state.selectedId = state.candidates.some(candidate => candidate.id === 'seat-moment') ? 'seat-moment' : state.candidates[0]?.id;
    renderCandidates(); updateMomentContext(); updateConsoleMode(); state.isGenerating = false; updateButtonLoading(false); startLogs();
    if (scroll) $('#result-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(data.isDemo ? '实时链路未完成，已保留可演示方案' : '已收到 MCP 实时菜单与价格，方案已更新');
  }

  function copyShareCard() {
    const selected = state.candidates.find(candidate => candidate.id === state.selectedId) || state.candidates[0];
    if (!selected) return;
    const text = `【麦时刻 / MCD MOMENTS】\n${vibeText[state.vibe]} · ${state.time} MIN · ${state.partySize} 人\n\n我把这一餐交给${selected.seat}：${selected.title}\n${selected.items.join(' + ')}\n价格：${formatPrice(selected.estimatedPriceCny)}\n\n不是菜单，是此刻刚刚好的理由。\n#麦时刻 #MCDMOMENTS`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('分享卡已复制，发给一起吃的人吧')).catch(() => fallbackCopy(text)); else fallbackCopy(text);
  }
  function fallbackCopy(text) { const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); try { document.execCommand('copy'); showToast('分享卡已复制'); } catch { showToast('复制失败，请手动选择方案内容'); } textarea.remove(); }

  function openChainDialog() {
    const dialog = $('#chain-dialog'); const body = $('#dialog-body'); if (!dialog || !body) return;
    body.innerHTML = toolMeta.map(([tool, label, desc], index) => `<div class="dialog-step"><b>0${index + 1}</b><div><strong>${escapeHTML(label)}</strong><small>${escapeHTML(tool)} · ${escapeHTML(desc)}</small></div><em>${state.isDemo ? 'DEMO' : 'LIVE'} ✓</em></div>`).join('');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  }
  function closeChainDialog() { const dialog = $('#chain-dialog'); if (dialog?.open && typeof dialog.close === 'function') dialog.close(); else dialog?.removeAttribute('open'); }

  function setupActions() {
    form?.addEventListener('submit', event => { event.preventDefault(); generateMoment(); });
    $('#copy-share')?.addEventListener('click', copyShareCard);
    $('#regenerate')?.addEventListener('click', () => generateMoment());
    $('#open-chain')?.addEventListener('click', openChainDialog);
    $('#dialog-close')?.addEventListener('click', closeChainDialog);
    $('#chain-dialog')?.addEventListener('click', event => { if (event.target.id === 'chain-dialog') closeChainDialog(); });
    $('#clear-log')?.addEventListener('click', () => { state.logs = []; renderLogs(); showToast('调用日志已清除'); });
  }
  function setupReveal() { const items = $$('.reveal'); if (!('IntersectionObserver' in window)) { items.forEach(item => item.classList.add('is-visible')); return; } const observer = new IntersectionObserver(entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } }), { threshold: .12 }); items.forEach(item => observer.observe(item)); }
  function boot() { setupInputs(); setupActions(); setupReveal(); if ($('#clock')) $('#clock').textContent = formatTime(); setInterval(() => { if ($('#clock')) $('#clock').textContent = formatTime(); }, 30000); renderCandidates(); updateMomentContext(); updateConsoleMode(); startLogs(); }
  boot();
})();
