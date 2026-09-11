/* Service worker театра RAT: офлайн-афиша (PWA) и пуш-уведомления.
   Кэширует оболочку сайта и последние данные; пуш приходит без текста, воркер сам спрашивает у сервера, что показать. */
var VERSION = "rat-20260913p";
var MEDIA = "rat-media";
var SHELL = ["./", "index.html", "play.html", "golos.html", "404.html", "manifest.webmanifest", "assets/favicon.svg", "assets/icon-192.png", "assets/tv.webp",
  "assets/site.css?v=20260913p", "assets/intro.css?v=20260913p", "assets/site.js?v=20260913p", "fonts/fonts.css?v=20260913p", "vendor/qrcode.min.js"];
var SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== MEDIA; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function rel(url) { return url.pathname.indexOf(SCOPE) === 0 ? url.pathname.slice(SCOPE.length) : url.pathname; }
function trim(cacheName, max) {
  return caches.open(cacheName).then(function (c) { return c.keys().then(function (keys) { if (keys.length <= max) return; return Promise.all(keys.slice(0, keys.length - max).map(function (k) { return c.delete(k); })); }); });
}
self.addEventListener("fetch", function (e) {
  var req = e.request; if (req.method !== "GET") return;
  var url = new URL(req.url); if (url.origin !== location.origin) return;
  var r = rel(url);
  if (/^admin/.test(r) || r === "api.php" && !/(^|&)a=data(&|$)/.test(url.search.slice(1))) return; // админку и API не трогаем
  if (req.mode === "navigate") {
    if (!/^(|index\.html|index\.php|play\.html|play\.php|golos|golos\.html|404\.html)$/.test(r)) return;
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) caches.open(VERSION).then(function (c) { c.put(req, res.clone()); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) { return hit || caches.match(r.indexOf("play") === 0 ? "play.html" : r.indexOf("golos") === 0 ? "golos.html" : "index.html"); });
    }));
    return;
  }
  if (r === "data/data.json" || r === "api.php") { // данные: сеть, при обрыве — последняя копия
    var key = r === "api.php" ? "api.php?a=data" : "data/data.json";
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) caches.open(VERSION).then(function (c) { c.put(key, res.clone()); });
      return res;
    }).catch(function () { return caches.match(key); }));
    return;
  }
  if (/^(assets|fonts|vendor)\//.test(r)) { // статика с версией в адресе: из кэша, иначе сеть
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res.ok) caches.open(VERSION).then(function (c) { c.put(req, res.clone()); }); return res; });
    }));
    return;
  }
  if (/^photos\//.test(r) && !/\.(mp4|webm|mov|mp3|m4a|ogg)$/i.test(r)) { // фото: из кэша, фоном обновляем; не больше 80 штук
    e.respondWith(caches.open(MEDIA).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res.ok) { c.put(req, res.clone()); trim(MEDIA, 80); } return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});

/* ---------- пуш-уведомления ---------- */
function api(path, body) {
  var opts = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  return fetch("api.php?a=" + path, opts).then(function (r) { if (!r.ok || (r.headers.get("content-type") || "").indexOf("json") < 0) throw 0; return r.json(); })
    .catch(function () { return fetch("api/" + path, opts).then(function (r) { return r.json(); }); });
}
function pending() {
  return self.registration.pushManager.getSubscription().then(function (sub) {
    if (!sub) return [];
    return api("push_msg", { endpoint: sub.endpoint }).then(function (j) { return j.messages || []; });
  }).catch(function () { return []; });
}
self.addEventListener("push", function (e) {
  e.waitUntil((function () {
    var data = null; try { data = e.data ? e.data.json() : null; } catch (x) {}
    return (data ? Promise.resolve([data]) : pending()).then(function (msgs) {
      if (!msgs.length) msgs = [{ title: "Театр RAT", body: "Загляните в афишу — есть новости.", url: "./" }];
      return Promise.all(msgs.map(function (m, i) {
        return self.registration.showNotification(m.title || "Театр RAT", { body: m.body || "", icon: "assets/icon-192.png", "assets/tv.webp", badge: "assets/badge-96.png", tag: m.tag || ("rat-" + i), renotify: true, lang: "ru", data: { url: m.url || "./" } });
      }));
    });
  })());
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = new URL(e.notification.data && e.notification.data.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) if (list[i].url === target && "focus" in list[i]) return list[i].focus();
    return self.clients.openWindow(target);
  }));
});
self.addEventListener("pushsubscriptionchange", function (e) {
  var old = e.oldSubscription;
  e.waitUntil(self.registration.pushManager.subscribe(old ? old.options : { userVisibleOnly: true }).then(function (sub) {
    return api("push_sub", { sub: sub.toJSON(), kind: "renew", old: old ? old.endpoint : "" });
  }).catch(function () {}));
});
