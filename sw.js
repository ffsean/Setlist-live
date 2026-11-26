/* YT 打軸工具 service worker
   - 自己網站的檔案:快取起來,離線也能開啟介面
   - 首頁:優先走網路(有網路時永遠是最新版),失敗才用快取
   - YouTube、Google 試算表等外部資源:完全不碰,照常走網路
   更新網站後若想強制所有人換新,把下面的版本號 +1 */
const CACHE = "yt-axis-v3";
const SHELL = [
  "./",
  "index.html",
  "tagger.html",
  "xlsx.mini.min.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 外部資源不攔截

  // 開啟頁面:網路優先,離線時退回快取的首頁
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put("index.html", copy));
          }
          return res;
        })
        .catch(() => caches.match("index.html").then(r => r || caches.match("./")))
    );
    return;
  }

  // 其他自家檔案:先給快取,同時背景更新
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
