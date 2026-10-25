(() => {
  'use strict';

  const toolMeta = [
    ['campaign-calendar', '活动与时段', '查看此刻可用活动'],
    ['list-nutrition-foods', '营养信息', '匹配能量与蛋白'],
    ['query-nearby-stores', '附近门店', '确认可执行的门店'],
    ['query-meals', '菜单候选', '筛选符合偏好的组合'],
    ['calculate-price', '价格与优惠', '计算预算内的实际价格']
  ];

  const state = {
    vibe: 'focus', budget: '25-40', time: 20, partySize: 1, prefs: new Set(),
    candidates: [], selectedId: null, isDemo: false, isError: false, errorMessage: '', hasRequested: false, isGenerating: false, logs: [], sourceData: null, toolStatus: {}
  };

  const vibeText = { focus: '赶稿冲刺', friends: '见朋友', recharge: '一个人回血', family: '带娃出门' };
  const budgetText = { '25-40': '¥25—40/人', '40-60': '¥40—60/人', '60-plus': '¥60+/人' };
  const momentTitles = {
    focus: ['赶稿不等人，先把选择缩短。', '把这段时间留给补给，回来继续冲。'],
    friends: ['见面别先讨论菜单。', '把时间留给彼此，吃什么有答案了。'],
    recharge: ['一个人的休息，不用预约。', '给自己一段不赶时间的补给。'],
    family: ['带娃出门，先省下一步选择。', '让一家人的这一餐更好决定。']
  };
  const timeTitles = {
    20: '20 分钟，也能吃得刚刚好。',
    35: '35 分钟，给补给留出从容一点的空间。',
    60: '有一小时，就把这一餐安排得舒服些。'
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
  function updateMomentContext() { const context = $('#result-context'); if (context) context.textContent = `${vibeText[state.vibe]} · ${budgetText[state.budget]} · ${state.time} MIN · ${state.partySize} 人`; }
  function updateParty(delta) { state.partySize = Math.max(1, Math.min(8, state.partySize + delta)); const output = $('#party-count'); if (output) output.textContent = String(state.partySize); updateMomentContext(); }

  function invalidateRecommendations() {
    if (!state.candidates.length) return;
    state.candidates = [];
    state.selectedId = null;
    state.sourceData = null;
    state.hasRequested = false;
    state.isDemo = false;
    state.isError = false;
    state.errorMessage = '';
    renderCandidates();
    updatePersonalizedHeader();
    updateConsoleMode();
  }

  function setupInputs() {
    $$('[data-field]').forEach(button => button.addEventListener('click', () => {
      const field = button.dataset.field;
      state[field] = field === 'time' ? Number(button.dataset.value) : button.dataset.value;
      $$(`[data-field="${field}"]`).forEach(item => setRadioState(item, item === button));
      invalidateRecommendations();
      updatePersonalizedHeader();
    }));
    $$('[data-pref]').forEach(button => button.addEventListener('click', () => {
      const pref = button.dataset.pref;
      if (state.prefs.has(pref)) state.prefs.delete(pref); else state.prefs.add(pref);
      button.setAttribute('aria-pressed', state.prefs.has(pref) ? 'true' : 'false');
      button.classList.toggle('is-selected', state.prefs.has(pref));
      invalidateRecommendations();
      updatePersonalizedHeader();
    }));
    $('#party-minus')?.addEventListener('click', () => { updateParty(-1); invalidateRecommendations(); updatePersonalizedHeader(); });
    $('#party-plus')?.addEventListener('click', () => { updateParty(1); invalidateRecommendations(); updatePersonalizedHeader(); });
  }

  function normalizeCandidate(candidate) {
    const items = Array.isArray(candidate?.items) ? candidate.items : [];
    const perPersonPrice = candidate?.estimatedPricePerPersonCny ?? (candidate?.estimatedPriceCny !== null && candidate?.estimatedPriceCny !== undefined ? Number(candidate.estimatedPriceCny) / state.partySize : null);
    return {
      ...candidate,
      id: safeText(candidate?.id, 'live-candidate'),
      seat: safeText(candidate?.seat, '实时方案'),
      title: safeText(candidate?.title, '按当前选择生成的方案'),
      tagline: safeText(candidate?.tagline),
      reason: safeText(candidate?.reason),
      items: items.map(item => typeof item === 'string' ? item : safeText(item?.name || item?.title, '推荐单品')),
      estimatedPriceCny: candidate?.estimatedPriceCny ?? candidate?.price ?? null,
      estimatedPricePerPersonCny: perPersonPrice,
      estimatedCaloriesKcal: candidate?.estimatedCaloriesKcal ?? candidate?.calories ?? null,
      discountCny: candidate?.discountCny ?? candidate?.saving ?? 0,
      priceSource: candidate?.priceSource || 'unknown',
      tools: Array.isArray(candidate?.tools) ? candidate.tools : []
    };
  }

  function candidateCard(candidate, index) {
    const winner = state.selectedId === candidate.id;
    const toolList = candidate.tools.slice(0, 5).map(tool => `<span>${escapeHTML(tool)}</span>`).join('');
    const itemList = candidate.items.slice(0, 4).map(item => `<li>${escapeHTML(item)}</li>`).join('');
    const priceSource = candidate.priceSource === 'calculate-price' ? 'MCP 实时计算' : state.isDemo ? '演示数据（非实价）' : '菜单返回价';
    const perPerson = candidate.estimatedPricePerPersonCny === null ? '' : `<span>人均 ${formatPrice(candidate.estimatedPricePerPersonCny)}</span>`;
    return `<article class="recommendation-card${winner ? ' is-winner' : ''}" data-candidate-id="${escapeHTML(candidate.id)}">
      <div class="rec-seat" aria-hidden="true">${String(index + 1).padStart(2, '0')}</div>
      <div class="rec-content">
        <div class="rec-kicker">${escapeHTML(candidate.seat)} · ${winner ? '当前选择' : '备选立场'}</div>
        <h3>${escapeHTML(candidate.title)}</h3>
        <p>${escapeHTML(candidate.tagline)}</p>
        <ul class="rec-items">${itemList}</ul>
        <div class="rec-meta">${perPerson}<span>${priceSource}</span>${Number(candidate.discountCny) > 0 ? `<span>省 ${formatPrice(candidate.discountCny)}</span>` : ''}</div>
      </div>
      <div class="rec-action"><div class="rec-price">${formatPrice(candidate.estimatedPriceCny)} <small>${state.partySize > 1 ? '合计' : '起'}</small></div><button class="vote-button" type="button" data-vote="${escapeHTML(candidate.id)}">${winner ? '已选这席' : '我选这席'}</button></div>
      ${winner ? '<span class="vote-count">YOUR PICK</span>' : ''}
      <div class="card-detail"><p>${escapeHTML(candidate.reason)}</p><div class="tool-tags">${toolList}</div></div>
    </article>`;
  }

  function renderCandidates() {
    if (!recommendations) return;
    if (state.isError) {
      recommendations.innerHTML = `<div class="recommendation-error" role="alert"><strong>暂时拿不到麦当劳实时数据</strong><p>${escapeHTML(state.errorMessage || '请检查 MCP 配置或网络后重试。为避免误导，此处不显示演示推荐。')}</p><button class="button button-outline" type="button" data-retry>重新请求实时数据</button></div>`;
      recommendations.querySelector('[data-retry]')?.addEventListener('click', () => generateMoment({ scroll: false }));
      return;
    }
    if (!state.candidates.length) {
      recommendations.innerHTML = '<div class="recommendation-empty" role="status">先调整你的状态、预算、时间或同行人数，再点击“生成我的麦时刻”。</div>';
      return;
    }
    state.candidates = state.candidates.map(normalizeCandidate);
    if (!state.candidates.some(candidate => candidate.id === state.selectedId)) state.selectedId = state.candidates[0]?.id;
    recommendations.innerHTML = state.candidates.map(candidateCard).join('');
    $$('[data-vote]', recommendations).forEach(button => button.addEventListener('click', () => {
      state.selectedId = button.dataset.vote;
      renderCandidates();
      updatePersonalizedHeader();
      const selected = state.candidates.find(candidate => candidate.id === state.selectedId);
      if (selected) showToast(`已选择${selected.seat}：${selected.title}`);
    }));
    const selected = state.candidates.find(candidate => candidate.id === state.selectedId) || state.candidates[0];
    if (selected && $('#reason-text')) $('#reason-text').textContent = selected.reason;
    if ($('#pass-id')) $('#pass-id').textContent = `MOM—${String(Math.floor(Math.random() * 900) + 100)}`;
    updatePersonalizedHeader();
  }

  function appendLog(tool, status = 'ok', note = '') { const now = new Date(); const time = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`; state.logs.push({ tool, status, note, time }); if (state.logs.length > 10) state.logs.shift(); renderLogs(); }
  function renderLogs() {
    if (!consoleLog) return;
    consoleLog.innerHTML = state.logs.map(log => `<div class="log-line"><span class="log-time">${escapeHTML(log.time)}</span><span class="${log.status === 'error' ? 'log-error' : log.status === 'demo' ? 'log-demo' : 'log-ok'}">${log.status === 'error' ? 'ERR' : log.status === 'demo' ? 'DEMO' : 'OK'}</span><span title="${escapeHTML(log.note)}">${escapeHTML(log.tool)}</span></div>`).join('');
  }
  function setToolLogs(toolStatus, isError) {
    state.logs = [];
    if (toolStatus && Object.keys(toolStatus).length) {
      Object.entries(toolStatus).forEach(([tool, result]) => appendLog(tool, result.status === 'ok' ? 'ok' : 'error', result.message || 'MCP response'));
    } else {
      toolMeta.forEach(([tool]) => appendLog(tool, isError ? 'error' : 'demo', isError ? 'Request failed' : 'No live token configured'));
    }
  }

  function updateConsoleMode() {
    const stateEl = $('#console-state');
    const modeEl = $('#console-mode');
    const foot = $('#console-foot-text');
    const header = $('#header-status');
    const waiting = !state.hasRequested && !state.isGenerating;
    if (stateEl) { stateEl.classList.toggle('is-live', state.hasRequested && !state.isDemo && !state.isError); stateEl.classList.toggle('is-error', state.isError); const label = $('b', stateEl); if (label) label.textContent = waiting ? 'READY' : state.isError ? 'MCP ERROR' : state.isDemo ? 'DEMO DATA' : 'LIVE DATA'; }
    if (modeEl) modeEl.textContent = waiting ? 'READY' : state.isError ? 'ERROR' : state.isDemo ? 'DEMO' : 'LIVE';
    if (foot) foot.textContent = waiting ? '点击生成后将请求麦当劳 MCP 实时数据' : state.errorMessage || (state.isDemo ? '此处为演示数据，未连接麦当劳实时 MCP' : '已收到 MCP 实时数据，未创建订单');
    if (header) header.textContent = waiting ? 'MCP READY' : state.isError ? 'MCP ERROR' : state.isDemo ? 'MCP DEMO' : 'MCP LIVE';
    if ($('#tool-count')) $('#tool-count').textContent = String(state.logs.length).padStart(2, '0');
  }

  async function fetchJSON(path, options = {}) { const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); const data = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(data.message || `HTTP ${response.status}`); error.status = response.status; error.payload = data; throw error; } return data; }
  async function requestRecommendations() {
    const payload = { city: '杭州', keyword: '杭州', vibe: state.vibe, goal: state.vibe, budget: state.budget, time: state.time, partySize: state.partySize, prefs: [...state.prefs], preferences: [...state.prefs] };
    try {
      const data = await fetchJSON('/api/challenge', { method: 'POST', body: JSON.stringify(payload) });
      state.hasRequested = true;
      if (!Array.isArray(data.candidates) || !data.candidates.length) throw new Error('服务未返回推荐方案');
      state.candidates = data.candidates.map(normalizeCandidate);
      state.isDemo = Boolean(data.isDemo);
      state.isError = false;
      state.errorMessage = '';
      state.sourceData = data.sourceData || null;
      state.toolStatus = data.toolStatus || {};
      setToolLogs(data.toolStatus, false);
      return data;
    } catch (error) {
      state.candidates = [];
      state.isDemo = false;
      state.isError = true;
      state.errorMessage = error.message || '实时数据暂不可用';
      state.hasRequested = true;
      state.sourceData = null;
      state.toolStatus = error.payload?.toolStatus || {};
      setToolLogs(state.toolStatus, true);
      return { isDemo: false, error: error.payload?.error || 'LIVE_REQUEST_FAILED', message: state.errorMessage, toolStatus: state.toolStatus };
    }
  }

  function updateButtonLoading(isLoading) { const button = $('#generate-button'); if (!button) return; button.classList.toggle('is-loading', isLoading); button.setAttribute('aria-busy', isLoading ? 'true' : 'false'); button.disabled = isLoading; const label = $('.button-label', button); if (label) label.textContent = isLoading ? '正在读取门店实时菜单…' : '生成我的麦时刻'; }
  function personalizedTitle() {
    const options = momentTitles[state.vibe] || momentTitles.focus;
    const tone = state.partySize > 1 ? `${state.partySize} 人同行` : options[0];
    const timeTone = timeTitles[state.time] || `${state.time} 分钟，按你的时间安排这一餐。`;
    return `${tone} · ${timeTone}`;
  }
  function updatePersonalizedHeader() {
    const title = $('#result-title');
    const kicker = $('#reason-text');
    const selected = state.candidates.find(candidate => candidate.id === state.selectedId);
    if (title) title.textContent = personalizedTitle();
    if (kicker) kicker.textContent = selected?.reason || `${vibeText[state.vibe]} · ${budgetText[state.budget]} · ${state.time} 分钟 · ${state.partySize} 人${state.prefs.size ? ` · ${[...state.prefs].map(key => ({ light: '清爽', full: '饱腹', sugar: '少糖/无糖', share: '适合分享' }[key])).join('、')}` : ''}`;
    updateMomentContext();
  }

  async function generateMoment({ scroll = true } = {}) {
    if (state.isGenerating) return;
    state.isGenerating = true;
    state.isDemo = false;
    state.isError = false;
    state.errorMessage = '';
    state.candidates = [];
    state.selectedId = null;
    updateButtonLoading(true);
    updatePersonalizedHeader();
    if (recommendations) recommendations.innerHTML = '<div class="recommendation-loading" role="status">正在请求麦当劳 MCP 的门店、菜单与价格数据…</div>';
    updateConsoleMode();
    const data = await requestRecommendations();
    state.selectedId = state.candidates.some(candidate => candidate.id === 'seat-moment') ? 'seat-moment' : state.candidates[0]?.id;
    renderCandidates();
    updatePersonalizedHeader();
    updateConsoleMode();
    state.isGenerating = false;
    updateButtonLoading(false);
    if (scroll) $('#result-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (data.isDemo) showToast('展示明确标注的演示方案，不是实时菜单或实时报价');
    else if (data.error) showToast(data.message || '实时数据获取失败，请检查后重试');
    else showToast('已根据你的选择更新实时菜单与价格方案');
  }

  function copyShareCard() {
    const selected = state.candidates.find(candidate => candidate.id === state.selectedId) || state.candidates[0];
    if (!selected) { showToast(state.errorMessage || '实时数据未就绪，请稍后重试'); return; }
    const price = state.isDemo ? '演示数据，非实时报价' : `${formatPrice(selected.estimatedPriceCny)}${selected.estimatedPricePerPersonCny !== null ? `（人均 ${formatPrice(selected.estimatedPricePerPersonCny)}）` : ''}`;
    const store = state.sourceData?.store?.storeName ? `门店：${state.sourceData.store.storeName}` : '';
    const text = `【麦时刻 / MCD MOMENTS】${state.isDemo ? ' · DEMO DATA' : ''}\n${vibeText[state.vibe]} · ${budgetText[state.budget]} · ${state.time} 分钟 · ${state.partySize} 人${state.prefs.size ? ` · 偏好 ${[...state.prefs].join('、')}` : ''}\n${store}\n\n我把这一餐交给${selected.seat}：${selected.title}\n${selected.items.join(' + ')}\n价格：${price}\n${selected.reason}\n\n不是菜单，是此刻刚刚好的理由。\n#麦时刻 #MCDMOMENTS`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('分享卡已复制，发给一起吃的人吧')).catch(() => fallbackCopy(text)); else fallbackCopy(text);
  }
  function fallbackCopy(text) { const textarea = document.createElement('textarea'); textarea.value = text; textarea.style.position = 'fixed'; textarea.style.opacity = '0'; document.body.appendChild(textarea); textarea.select(); try { document.execCommand('copy'); showToast('分享卡已复制'); } catch { showToast('复制失败，请手动选择方案内容'); } textarea.remove(); }

  function openChainDialog() {
    const dialog = $('#chain-dialog'); const body = $('#dialog-body'); if (!dialog || !body) return;
    const status = state.toolStatus || {};
    body.innerHTML = toolMeta.map(([tool, label, desc], index) => {
      const result = status[tool] || Object.entries(status).find(([name]) => name.startsWith(`${tool}:`))?.[1];
      const mark = state.isError ? '未完成' : state.isDemo ? '演示' : result?.status === 'ok' ? '已返回' : result?.status === 'error' ? '失败' : '已执行';
      const errorText = result?.message ? ` · ${result.message}` : '';
      return `<div class="dialog-step"><b>0${index + 1}</b><div><strong>${escapeHTML(label)}</strong><small>${escapeHTML(tool)} · ${escapeHTML(desc)}${escapeHTML(errorText)}</small></div><em>${escapeHTML(mark)}</em></div>`;
    }).join('');
    if (state.sourceData?.store) body.insertAdjacentHTML('afterbegin', `<p class="chain-store-note">本次门店：${escapeHTML(state.sourceData.store.storeName || '')} · ${escapeHTML(state.sourceData.store.address || '')}</p>`);
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
  function boot() { setupInputs(); setupActions(); setupReveal(); if ($('#clock')) $('#clock').textContent = formatTime(); setInterval(() => { if ($('#clock')) $('#clock').textContent = formatTime(); }, 30000); updatePersonalizedHeader(); renderCandidates(); updateConsoleMode(); }
  boot();
})();
