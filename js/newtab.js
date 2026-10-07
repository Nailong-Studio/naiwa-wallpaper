// 奶蛙壁纸 · 新标签页主逻辑

const $ = s => document.querySelector(s);

const DEFAULT_SETTINGS = { source: 'naiwa', customUrl: '', autoSwitch: 0, engine: 'baidu' };
const ENGINES = {
  baidu: 'https://www.baidu.com/s?wd=',
  bing: 'https://www.bing.com/search?q=',
  google: 'https://www.google.com/search?q='
};

let settings = { ...DEFAULT_SETTINGS };
let current = null;   // 当前展示的壁纸 { source, url?, thumb?, css?, title, copyright, date?, updatedAt }
let favs = [];        // 收藏列表
let picsumCache = null;
let naiwaCache = null;

const absUrl = p => new URL(p, location.href).href;

/* ---------------- 启动 ---------------- */

async function init() {
  settings = { ...DEFAULT_SETTINGS, ...(await store.get('nw:settings') || {}) };
  current = await store.get('nw:current');
  favs = (await store.get('nw:favs')) || [];

  renderClock();
  setInterval(renderClock, 1000);
  bindEvents();
  renderSettingsUI();
  renderFavGrid();

  if (current) {
    queueApply(() => applyCurrent(current, true)); // 先瞬间铺上缓存壁纸，再在后台刷新
  } else {
    pickGradient(); // 首次打开先铺一层渐变，避免网络壁纸加载前一片空白
  }
  await refresh(false);
}

/* ---------------- 背景应用（串行队列，防止交叉错位） ---------------- */

const bgEls = [$('#bg-a'), $('#bg-b')];
let bgFront = 0;

let applyChain = Promise.resolve();
function queueApply(fn) {
  applyChain = applyChain.then(fn).catch(e => console.warn('apply failed:', e));
  return applyChain;
}

function swapBg(back, front, instant) {
  if (instant) {
    back.style.transition = 'none';
    back.classList.add('show');
    front.classList.remove('show');
    requestAnimationFrame(() => { back.style.transition = ''; });
    return;
  }
  back.classList.add('show');
  front.classList.remove('show');
}

// 应用一张壁纸：等图片就绪后交叉淡入；返回 Promise，队列据此串行化
function applyCurrent(item, instant = false) {
  return new Promise(resolve => {
    if (!item) return resolve();
    const back = bgEls[1 - bgFront];
    const front = bgEls[bgFront];
    const paint = el => {
      el.classList.toggle('grad', !!item.css);
      el.style.setProperty('--img', item.css || `url("${item.url}")`);
    };
    let settled = false;
    const finish = () => {
      if (settled) return resolve();
      settled = true;
      if (item.css || item.url) paint(back);
      swapBg(back, front, instant);
      bgFront = 1 - bgFront;

      const credit = item.title ? (item.copyright ? `${item.title} · ${item.copyright}` : item.title) : '';
      $('#credit').textContent = credit;
      updateFavButton();
      resolve();
    };

    if (item.css) {
      finish();
    } else if (item.url) {
      const img = new Image();
      img.onload = finish;
      img.onerror = () => {
        finish();
        if (!instant && item.source !== 'gradient') {
          current = pickGradientItem();
          saveAndApply();
        }
      };
      img.src = item.url;
      setTimeout(() => { if (!img.complete) finish(); }, 8000); // 网络过慢时也先切过去
    } else {
      finish();
    }
  });
}

// 重新应用当前壁纸（不写存储）
function reapply() {
  return queueApply(() => applyCurrent(current));
}

// 写存储并应用
function saveAndApply() {
  if (!current) return reapply();
  const snapshot = current;
  return queueApply(async () => {
    await store.set({ 'nw:current': snapshot });
    await applyCurrent(snapshot);
  });
}

/* ---------------- 壁纸调度 ---------------- */

async function refresh(force = false) {
  const nextBtn = $('#btn-next');
  nextBtn.classList.add('spinning');
  try {
    await refreshInner(force);
  } finally {
    nextBtn.classList.remove('spinning');
  }
}

async function refreshInner(force = false) {
  const elapsed = settings.autoSwitch > 0 &&
    (!current || Date.now() - (current.updatedAt || 0) > settings.autoSwitch * 60000);

  if (settings.source === 'custom') {
    if (!settings.customUrl) {
      if (!force) toast('请先在设置里填写图片链接');
      if (!current) pickGradient();
      return;
    }
    if (!force && !elapsed && current && current.source === 'custom' && current.url === settings.customUrl) {
      return reapply();
    }
    current = { source: 'custom', url: settings.customUrl, thumb: settings.customUrl, title: '自定义壁纸', copyright: '', updatedAt: Date.now() };
    return saveAndApply();
  }

  if (settings.source === 'local') {
    if (current) reapply();
    else pickGradient();
    return;
  }

  if (settings.source === 'naiwa') {
    if (!naiwaCache) naiwaCache = await fetchNaiwaList();
    if (!naiwaCache.length) {
      if (current) return reapply();
      return pickGradient();
    }
    if (!force && !elapsed && current && current.source === 'naiwa') {
      return reapply();
    }
    const urlOf = it => absUrl(it.file);
    const pool = naiwaCache.filter(it => !current || current.url !== urlOf(it));
    const chosen = pool[Math.floor(Math.random() * pool.length)] || naiwaCache[0];
    current = {
      source: 'naiwa',
      url: urlOf(chosen),
      thumb: absUrl(chosen.thumb),
      title: chosen.title,
      copyright: '奶蛙主题 · 本地 4K',
      updatedAt: Date.now()
    };
    saveAndApply();
    // 预热另一张，换一张时即刻显示
    const other = naiwaCache.find(it => urlOf(it) !== current.url);
    if (other) { const img = new Image(); img.src = urlOf(other); }
    return;
  }

  if (settings.source === 'random') {
    if (!force && !elapsed && current && current.source === 'random') {
      return reapply();
    }
    return pickRandom('随机美图', force);
  }

  // bing
  const list = await fetchBingList();
  if (!list.length) {
    // Bing 不可用时退到随机美图；连 picsum 也不通就保留现有壁纸（pickRandom 内处理）
    return pickRandom('随机美图', force);
  }
  const needSwitch = force || elapsed || !current ||
    current.source !== 'bing' ||
    (current.date && current.date !== list[0].date);
  if (!needSwitch) return reapply();

  let idx = 0;
  if (current && current.source === 'bing' && Number.isInteger(current.index) && (force || elapsed)) {
    idx = (current.index + 1) % list.length;
  }
  current = { ...list[idx], source: 'bing', index: idx, updatedAt: Date.now() };
  saveAndApply();

  // 预加载下一张，切换更顺滑
  const next = list[(idx + 1) % list.length];
  if (next) { const img = new Image(); img.src = next.url; }
}

async function pickRandom(label, force = false) {
  if (!picsumCache) picsumCache = await fetchPicsumList();
  if (!picsumCache.length) {
    // 网络不通：有壁纸就保留，没有就铺渐变；用户主动点“换一张”时给出提示
    if (current) {
      if (force) toast('网络似乎不太顺畅，稍后再试');
      return reapply();
    }
    return pickGradient();
  }
  const urlOf = p => `https://picsum.photos/id/${p.id}/1920/1080`;
  const pool = picsumCache.filter(p => !current || current.url !== urlOf(p));
  const chosen = pool[Math.floor(Math.random() * pool.length)] || picsumCache[0];
  current = {
    source: 'random',
    url: urlOf(chosen),
    thumb: `https://picsum.photos/id/${chosen.id}/420/262`,
    title: label,
    copyright: `Photo by ${chosen.author} / Picsum`,
    updatedAt: Date.now()
  };
  saveAndApply();
}

function pickGradient() {
  current = pickGradientItem();
  saveAndApply();
}

function pickGradientItem() {
  const g = GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)];
  return { source: 'gradient', title: g.name, copyright: '离线渐变壁纸', css: g.css, updatedAt: Date.now() };
}

/* ---------------- 时钟 ---------------- */

function renderClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const hhEl = $('#hh');
  const mmEl = $('#mm');
  if (hhEl.textContent !== hh) hhEl.textContent = hh;
  if (mmEl.textContent !== mm) {
    mmEl.textContent = mm;
    mmEl.classList.remove('tick');
    void mmEl.offsetWidth; // 重启动画
    mmEl.classList.add('tick');
  }

  const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  $('#date').textContent = `${now.getMonth() + 1}月${now.getDate()}日 星期${week}`;

  const h = now.getHours();
  const greet =
    h >= 5 && h < 11 ? '早上好' :
    h >= 11 && h < 13 ? '中午好' :
    h >= 13 && h < 18 ? '下午好' :
    h >= 18 && h < 23 ? '晚上好' : '夜深了';
  $('#greet').textContent = greet;
}

/* ---------------- 收藏 ---------------- */

function isFaved() {
  return current && favs.some(f => f.url === current.url);
}

function updateFavButton() {
  $('#btn-fav').classList.toggle('faved', isFaved());
}

async function toggleFav() {
  if (!current || current.source === 'gradient') return toast('当前壁纸不支持收藏');
  const favBtn = $('#btn-fav');
  favBtn.classList.remove('pop');
  void favBtn.offsetWidth;
  favBtn.classList.add('pop');
  if (isFaved()) {
    favs = favs.filter(f => f.url !== current.url);
    toast('已取消收藏');
  } else {
    favs.unshift({
      url: current.url, thumb: current.thumb, title: current.title,
      copyright: current.copyright, date: new Date().toISOString().slice(0, 10)
    });
    toast('已收藏 ♥');
  }
  await store.set({ 'nw:favs': favs });
  updateFavButton();
  renderFavGrid();
}

function renderFavGrid() {
  const grid = $('#fav-grid');
  grid.innerHTML = '';
  $('#fav-empty').style.display = favs.length ? 'none' : 'block';
  favs.forEach(f => {
    const item = document.createElement('div');
    item.className = 'fav-item';
    const img = document.createElement('img');
    img.src = f.thumb || f.url;
    img.loading = 'lazy';
    img.onerror = () => { item.remove(); };
    const del = document.createElement('button');
    del.className = 'fav-del';
    del.textContent = '×';
    del.title = '移除';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      favs = favs.filter(x => x.url !== f.url);
      await store.set({ 'nw:favs': favs });
      updateFavButton();
      renderFavGrid();
    });
    item.append(img, del);
    item.addEventListener('click', () => {
      current = { source: 'faved', url: f.url, thumb: f.thumb, title: f.title, copyright: f.copyright, updatedAt: Date.now() };
      saveAndApply();
      closePanel();
    });
    grid.appendChild(item);
  });
}

/* ---------------- 下载 ---------------- */

async function downloadWallpaper() {
  if (!current || current.css) return toast('当前壁纸不支持下载');
  const name = `奶蛙壁纸_${(current.title || 'wallpaper').replace(/[\\/:*?"<>|]/g, '')}_${new Date().toISOString().slice(0, 10)}.jpg`;
  try {
    const res = await fetch(current.url);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('已开始下载');
  } catch (e) {
    window.open(current.url, '_blank'); // 兜底：新窗口打开让用户手动保存
  }
}

/* ---------------- 设置面板 ---------------- */

function openPanel() { $('#panel').classList.add('open'); }
function closePanel() { $('#panel').classList.remove('open'); }

function renderSettingsUI() {
  document.querySelectorAll('input[name="source"]').forEach(r => { r.checked = r.value === settings.source; });
  $('#custom-url').value = settings.customUrl;
  updateCustomExtra();
  $('#auto-switch').value = String(settings.autoSwitch);
  $('#engine').value = settings.engine;
}

function updateCustomExtra() {
  $('#custom-extra').classList.toggle('open', settings.source === 'custom');
}

function bindSettingsEvents() {
  document.querySelectorAll('input[name="source"]').forEach(r => {
    r.addEventListener('change', async () => {
      settings.source = r.value;
      updateCustomExtra();
      await saveSettings();
      refresh(true);
    });
  });

  $('#custom-url').addEventListener('change', async () => {
    settings.customUrl = $('#custom-url').value.trim();
    await saveSettings();
    if (settings.source === 'custom') refresh(true);
  });

  $('#auto-switch').addEventListener('change', async () => {
    settings.autoSwitch = Number($('#auto-switch').value);
    await saveSettings();
    toast('已保存自动切换设置');
  });

  $('#btn-upload').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      current = { source: 'local', url: reader.result, title: '本地图片', copyright: file.name, updatedAt: Date.now() };
      settings.source = 'local';
      document.querySelectorAll('input[name="source"]').forEach(r => { r.checked = false; });
      updateCustomExtra();
      await saveSettings();
      saveAndApply();
      toast('已应用本地图片');
      closePanel();
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  $('#btn-reset').addEventListener('click', async () => {
    settings = { ...DEFAULT_SETTINGS };
    await saveSettings();
    renderSettingsUI();
    toast('已恢复默认设置');
    refresh(true);
  });
}

async function saveSettings() {
  await store.set({ 'nw:settings': settings });
}

/* ---------------- 其它交互 ---------------- */

function bindEvents() {
  $('#search-form').addEventListener('submit', e => {
    e.preventDefault();
    const q = $('#q').value.trim();
    if (!q) return;
    location.href = ENGINES[settings.engine] + encodeURIComponent(q);
  });
  $('#engine').addEventListener('change', async () => {
    settings.engine = $('#engine').value;
    await saveSettings();
  });

  $('#btn-next').addEventListener('click', () => refresh(true));
  $('#btn-fav').addEventListener('click', toggleFav);
  $('#btn-download').addEventListener('click', downloadWallpaper);
  $('#btn-settings').addEventListener('click', () => {
    $('#panel').classList.contains('open') ? closePanel() : openPanel();
  });
  $('#btn-close').addEventListener('click', closePanel);
  bindSettingsEvents();

  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
    if (e.key === 'Escape') return closePanel();
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); refresh(true); }
    else if (e.key.toLowerCase() === 'f') toggleFav();
    else if (e.key.toLowerCase() === 'd') downloadWallpaper();
    else if (e.key.toLowerCase() === 's') openPanel();
  });

  // 双击空白处换一张（避开面板、搜索框和底栏）
  document.addEventListener('dblclick', e => {
    if (e.target.closest('.panel, .search, .actions, .credit, button, input, select')) return;
    refresh(true);
  });
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

init();
