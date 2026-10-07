// 壁纸数据源：Bing 每日精选 / Picsum 随机美图 / 离线渐变兜底

const BING_HOSTS = ['https://cn.bing.com', 'https://www.bing.com'];
const BING_TTL = 60 * 60 * 1000; // 列表缓存 1 小时
const FETCH_TIMEOUT = 8000;      // 网络异常/挂起时最多等 8 秒

function fetchWithTimeout(url, ms = FETCH_TIMEOUT) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// 所有网络请求都失败时的兜底壁纸，保证新标签页永远不空白
const GRADIENTS = [
  { name: '深海蓝',   css: 'linear-gradient(135deg,#0b1e3a 0%,#1e3a8a 55%,#3b82f6 100%)' },
  { name: '落日余晖', css: 'linear-gradient(135deg,#f97316 0%,#ec4899 55%,#8b5cf6 100%)' },
  { name: '薄荷晨雾', css: 'linear-gradient(135deg,#34d399 0%,#0ea5e9 100%)' },
  { name: '静谧夜空', css: 'linear-gradient(135deg,#0f172a 0%,#4c1d95 100%)' },
  { name: '蜜桃气泡', css: 'linear-gradient(135deg,#fecaca 0%,#fda4af 50%,#fcd34d 100%)' },
  { name: '雨林深绿', css: 'linear-gradient(145deg,#064e3b 0%,#10b981 60%,#a7f3d0 100%)' }
];

async function fetchBingList() {
  let cached = await store.get('nw:bing');
  if (cached && Date.now() - cached.ts < BING_TTL && Array.isArray(cached.list)) {
    return cached.list;
  }
  for (const host of BING_HOSTS) {
    try {
      const res = await fetchWithTimeout(`${host}/HPImageArchive.aspx?format=js&idx=0&n=8`);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data.images || !data.images.length) continue;
      const list = data.images.map(im => ({
        url: host + im.url,
        thumb: host + im.url.replace('_1920x1080', '_640x480'),
        title: im.title || (im.copyright || '').replace(/\s*\(.*?\)\s*$/, ''),
        copyright: im.copyright || '',
        date: (im.fullstartdate || '').slice(0, 8)
      }));
      await store.set({ 'nw:bing': { ts: Date.now(), list } });
      return list;
    } catch (e) {
      // 换下一个域名重试
    }
  }
  return cached && Array.isArray(cached.list) ? cached.list : [];
}

async function fetchPicsumList() {
  const page = 1 + Math.floor(Math.random() * 30);
  try {
    const res = await fetchWithTimeout(`https://picsum.photos/v2/list?page=${page}&limit=100`);
    if (!res.ok) return [];
    const arr = await res.json();
    return (arr || []).map(x => ({ id: x.id, author: x.author }));
  } catch (e) {
    return [];
  }
}

// 奶蛙主题：清单随扩展打包，无网络依赖，打开即显
// 素材源在 Nailong-Studio/wallpaper 的 4k/ 目录（中文语义命名 + 同名叙事）
async function fetchNaiwaList() {
  try {
    const res = await fetchWithTimeout('wallpapers/list.json', 4000);
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}
