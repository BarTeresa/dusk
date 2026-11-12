const CACHE = 'dusk-20261113012727';
const APP_MARK = 'bk_custom_v1';   // 本应用页面里必然存在的标记，用来识别"回来的到底是不是我们的页面"

/* 旧 WorkBuddy 沙盒的链接必须带 sharecode，裸链接回 403「链接不完整」；迁到 EdgeOne + 自有域名后为空。
   保留这段只为兼容旧链接/旧桌面图标：没有 sharecode 时 withShare 原样返回。 */
const SHARE = (function(){
  try { return new URL(self.location.href).searchParams.get('sharecode') || ''; } catch(e){ return ''; }
})();
function withShare(u){
  if(!SHARE) return u;
  if(u.indexOf('sharecode=') >= 0) return u;
  return u + (u.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + encodeURIComponent(SHARE);
}
/* 缓存 key 统一去掉 sharecode / v：换个链接访问也不会整份缓存对不上 */
function cleanKey(u){
  try {
    const x = new URL(u, self.location.href);
    x.searchParams.delete('sharecode');
    x.searchParams.delete('v');
    return x.href;
  } catch(e){ return u; }
}
const PAGE_FILES = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async function(){
    const c = await caches.open(CACHE);
    await Promise.all(PAGE_FILES.map(async function(f){
      try {
        const res = await fetch(withShare(f), { cache: 'reload' });
        if (res && res.ok) await c.put(f, res);   // 以不带参数的干净地址当 key
      } catch(err){}
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // 比价页是独立应用，不归配方 SW 管；否则离线时会拿配方页给它兜底
  if (url.pathname === '/price' || url.pathname.startsWith('/price/')) return;
  const isPage = url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  if (isPage) {
    // 页面网络优先，而且强制用一个「每分钟一变」的 URL 去取：
    // 托管平台的 CDN 会把 index.html 缓存一小时以上（实测 Age 3500~4200s）且不理会客户端 no-cache，
    // 部署也不会让它失效 —— 结果就是新版根本上不去。
    // 带上分钟级参数 = 每分钟都是全新 URL，必定回源；同一分钟内大家共用一份，CDN 仍然有缓存价值。
    // 兜底：服务端返回的不是本应用（沙箱停了、或链接缺 sharecode 回 403）或请求失败 → 回落缓存。
    const bustUrl = new URL(e.request.url);
    bustUrl.searchParams.delete('v');
    if (SHARE && !bustUrl.searchParams.get('sharecode')) bustUrl.searchParams.set('sharecode', SHARE);
    bustUrl.searchParams.set('v', String(Math.floor(Date.now() / 60000)));
    const bust = new Request(bustUrl.href, { cache: 'no-store' });
    e.respondWith(
      fetch(bust).then(res => {
        if (!res.ok) throw new Error('http ' + res.status);
        const probe = res.clone(), copy = res.clone();
        return probe.text().then(txt => {
          if (txt.indexOf(APP_MARK) === -1) throw new Error('not our page');
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        });
      }).catch(() => caches.match('./index.html').then(h => h || caches.match('./')))
    );
    return;
  }
  // 静态资源缓存优先，兜底网络
  const key = cleanKey(url.href);
  e.respondWith(
    caches.match(key).then(hit => hit || fetch(withShare(e.request.url)).then(res => {
      const copy = res.clone();
      if (res.ok && url.origin === self.location.origin) caches.open(CACHE).then(c => c.put(key, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});