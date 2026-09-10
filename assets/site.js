/* ===== Театр RAT — общие функции главной и страниц спектаклей ===== */
window.RAT = (function () {
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var initials = function (n) { return String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(""); };
  var MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  var MONTHS_SHORT = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];
  var DAYS = ["вс","пн","вт","ср","чт","пт","сб"];
  var parseDate = function (d) { var p = String(d || "").split("-").map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var todayStr = function () { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var fmtLong = function (e) { var d = parseDate(e.date); return d.getDate() + " " + MONTHS[d.getMonth()] + ", " + DAYS[d.getDay()] + (e.time ? " · " + e.time : ""); };
  var BADGES = { premiere: "Премьера", last: "Последний показ", few: "Мало билетов", soldout: "Sold out" };

  /* адрес сайта для ссылок в соцсети и разметки */
  var siteUrl = function () { return location.origin + location.pathname.replace(/[^\/]*$/, ""); };
  var playUrl = function (p) { return "play.html?id=" + encodeURIComponent(p.id); };

  /* ---------- данные ---------- */
  function loadData(fallback) {
    var urls = ["data/data.json?t=" + Date.now(), "/api/data", "api.php?a=data"], log = [];
    return urls.reduce(function (chain, url) {
      return chain.then(function (found) {
        if (found) return found;
        return fetch(url, { cache: "no-store", credentials: "same-origin" }).then(function (r) {
          var ct = r.headers.get("content-type") || "";
          if (!r.ok || ct.indexOf("json") < 0) { log.push(url + " → " + r.status); return null; }
          return r.json().then(function (j) { return j && (j.theatre || j.actors) ? j : null; });
        }).catch(function (e) { log.push(url + " → " + e.message); return null; });
      });
    }, Promise.resolve(null)).then(function (d) {
      if (!d) { d = fallback || {}; var g = document.getElementById("diag"); if (g) g.textContent = "Данные не загрузились, показана заглушка. Обновите страницу.\n" + log.join("\n"); }
      d.theatre = d.theatre || {}; d.plays = d.plays || []; d.events = d.events || []; d.actors = d.actors || []; d.reviews = d.reviews || []; d.gallery = d.gallery || [];
      afishaInit(d.theatre);
      return applyLive(d);
    });
  }
  /* ---------- живые остатки мест из Афиши (через api.php, кэш 10 минут) ---------- */
  function applyLive(d) {
    var need = (d.events || []).some(function (e) { return e.afishaSessionId; });
    if (!need) return Promise.resolve(d);
    var urls = ["api.php?a=afisha_status", "/api/afisha_status"];
    return urls.reduce(function (p, url) {
      return p.then(function (st) { if (st) return st; return fetch(url, { cache: "no-store" }).then(function (r) { if (!r.ok || (r.headers.get("content-type") || "").indexOf("json") < 0) return null; return r.json(); }).catch(function () { return null; }); });
    }, Promise.resolve(null)).then(function (st) {
      if (!st || !st.sessions) return d;
      d.events.forEach(function (e) {
        var s = e.afishaSessionId && st.sessions[e.afishaSessionId]; if (!s) return;
        e.live = s; e.badges = (e.badges || []).slice();
        if (s.count === 0) { if (e.badges.indexOf("soldout") < 0) e.badges.push("soldout"); }
        else { e.badges = e.badges.filter(function (b) { return b !== "soldout"; }); if (s.count <= 15 && e.badges.indexOf("few") < 0) e.badges.push("few"); }
        if (s.minPrice > 0) e.price = "от " + s.minPrice + " ₽";
      });
      d.liveUpdated = st.updated || 0;
      return d;
    });
  }
  var byId = function (d) { var m = {}; d.plays.forEach(function (p) { m[p.id] = p; }); return m; };
  var upcoming = function (d) { var t = todayStr(); return d.events.filter(function (e) { return e.date >= t; }).sort(function (a, b) { return (a.date + a.time).localeCompare(b.date + b.time); }); };
  var ticket = function (e, p, th) { return (e && e.ticketUrl) || (p && p.ticketUrl) || (th && th.ticketsUrl) || ""; };
  var hasBadge = function (e, b) { return Array.isArray(e.badges) && e.badges.indexOf(b) >= 0; };

  /* ---------- виджет билетов «Афиши» (tickets.afisha.ru), как на teatrdoc.ru ----------
     Партнёрский ID театра-площадки задаётся в админке; у показа — ID сеанса, у спектакля — ID спектакля.
     Кнопка открывает окно виджета прямо на сайте; если виджет не загрузился — переход по обычной ссылке. */
  var afisha = { partner: "", widget: null, loading: null };
  function afishaAttrs(e, p, th) {
    if (!(th && th.afishaPartnerId)) return "";
    if (e && e.afishaSessionId) return ' data-afisha-session="' + esc(e.afishaSessionId) + '"';
    if (p && p.afishaShowId) return ' data-afisha-show="' + esc(p.afishaShowId) + '"';
    return "";
  }
  var plural = function (n, one, few, many) { var m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? one : (m >= 2 && m <= 4 && (h < 10 || h >= 20)) ? few : many; };
  function leftBadge(e) {
    var c = e && e.live && e.live.count;
    if (!c || c > 15) return "";
    return '<span class="left">Осталось ' + c + " " + plural(c, "место", "места", "мест") + "</span>";
  }
  function buyBtn(e, p, th, label, cls) {
    var u = ticket(e, p, th), a = afishaAttrs(e, p, th);
    if (!u && !a) return "";
    var lb = leftBadge(e);
    return '<a class="btn ' + (cls || "") + (lb ? " has-left" : "") + '" href="' + (u ? esc(u) : "#") + '"' + (a ? a : ' target="_blank" rel="noopener"') + a + ">" + label + lb + "</a>";
  }
  function applyBuy(el, e, p, th) {
    var u = ticket(e, p, th), sess = e && e.afishaSessionId, show = p && p.afishaShowId;
    el.href = u || "#";
    if (th && th.afishaPartnerId && (sess || show)) { if (sess) el.setAttribute("data-afisha-session", sess); else el.setAttribute("data-afisha-show", show); el.removeAttribute("target"); return true; }
    if (u) { el.target = "_blank"; el.rel = "noopener"; }
    return !!u;
  }
  function applyLeft(el, e) { var lb = leftBadge(e); if (lb && !el.querySelector(".left")) { el.classList.add("has-left"); el.insertAdjacentHTML("beforeend", lb); } }

  /* ---------- счётчик посещений без cookie ---------- */
  function hit(page) {
    var q = "p=" + encodeURIComponent(page);
    try { if (navigator.sendBeacon && navigator.sendBeacon("api.php?a=hit&" + q)) return; } catch (x) {}
    fetch("api.php?a=hit&" + q, { keepalive: true }).then(function (r) { if (!r.ok) throw 0; }).catch(function () { fetch("/api/hit?" + q, { keepalive: true }).catch(function () {}); });
  }

  /* ---------- крыса, пробегающая по ленте ---------- */
  function marqRat() {
    var box = document.querySelector(".marq-outer"); if (!box || box.querySelector(".marq-rat")) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    box.insertAdjacentHTML("beforeend", '<svg class="marq-rat" viewBox="0 0 64 28" aria-hidden="true"><path d="M2 20c6-2 10-3 14-2l-2-6c0-4 4-6 8-5 3 1 5 4 9 5h9c6 0 11 2 15 5 1 1 3 2 5 2 2 0 3-1 3-2-2-2-4-3-7-4-4-3-9-5-16-5h-8c-3-3-6-6-11-6-7 0-12 5-11 11l-8 5z" fill="#000"/><circle cx="46" cy="14" r="1.6" fill="#c9ff3d"/><path d="M30 8c-2-3-1-6 1-7 1 1 1 4 0 7z" fill="#000"/></svg>');
    var rat = box.querySelector(".marq-rat");
    var run = function () { rat.classList.remove("run"); void rat.offsetWidth; rat.classList.add("run"); setTimeout(run, 40000 + Math.random() * 50000); };
    setTimeout(run, 6000 + Math.random() * 8000);
  }
  function afishaLoad() {
    if (afisha.widget) return Promise.resolve(afisha.widget);
    if (afisha.loading) return afisha.loading;
    afisha.loading = new Promise(function (res, rej) {
      var sc = document.createElement("script");
      sc.src = "https://tickets.afisha.ru/wl/embed/widget.js?" + Date.now(); sc.async = true;
      var fail = function (err) { afisha.loading = null; if (sc.parentNode) sc.parentNode.removeChild(sc); rej(err || new Error("widget load failed")); };
      sc.onload = function () { try { afisha.widget = new AfishaWidget(afisha.partner, "events"); res(afisha.widget); } catch (err) { fail(err); } };
      sc.onerror = function () { fail(); };
      setTimeout(function () { if (!afisha.widget) fail(new Error("widget load timeout")); }, 12000);
      document.head.appendChild(sc);
    });
    return afisha.loading;
  }
  function afishaInit(th) {
    afisha.partner = (th && th.afishaPartnerId) || "";
    if (!afisha.partner) return;
    // пока окно виджета открыто — класс на <html>, чтобы наш CSS заблокировал фон и растянул окно
    var sync = function () {
      var m = document.getElementById("modal");
      document.documentElement.classList.toggle("afisha-open", !!m);
      if (m && !m.querySelector(".rat-modal-head")) {
        var head = document.createElement("div"); head.className = "rat-modal-head";
        head.innerHTML = '<svg class="rat"><use href="#rat"/></svg><span>Билеты</span><small>' + esc(th.name || "Театр RAT") + ' ✦ оплата через Афишу, билет придёт на почту</small>';
        m.insertBefore(head, m.firstChild);
      }
    };
    if (window.MutationObserver) new MutationObserver(sync).observe(document.body, { childList: true });
    window.addEventListener("popstate", function () { setTimeout(sync, 50); });
    var idle = window.requestIdleCallback || function (f) { setTimeout(f, 2500); };
    idle(function () { afishaLoad().catch(function () {}); });
  }
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("[data-afisha-session],[data-afisha-show]");
    if (!a || !afisha.partner) return;
    ev.preventDefault();
    var sess = a.getAttribute("data-afisha-session"), show = a.getAttribute("data-afisha-show"), href = a.getAttribute("href");
    var label = a.textContent; a.textContent = "Открываем…";
    var open = function (w) { a.textContent = label; w.openModal(sess ? Number(sess) : { shows_id: Number(show) }); };
    var fallback = function () { a.textContent = label; if (href && href !== "#") location.href = href; };
    // одна повторная попытка загрузки, если первая (фоновая) сорвалась; иначе — обычный переход в этой же вкладке
    afishaLoad().then(open).catch(function () { afishaLoad().then(open).catch(fallback); });
  });

  /* ---------- бегущая лента ---------- */
  function marquee(items) {
    var tracks = document.querySelectorAll(".marq .track"); if (!tracks.length) return;
    var html = ""; for (var k = 0; k < 4; k++) items.forEach(function (t) { html += "<span>" + esc(t) + "</span><i>✦</i>"; });
    tracks.forEach(function (t) { t.innerHTML = html; });
    var fit = function () { var w = tracks[0].getBoundingClientRect().width; tracks.forEach(function (t) { t.style.animationDuration = (w / 80) + "s"; }); };
    fit(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  }

  /* ---------- «добавить в календарь» (.ics) ---------- */
  function icsHref(e, p, th) {
    var d = parseDate(e.date), hm = (e.time || "19:00").split(":").map(Number);
    var start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), hm[0] || 19, hm[1] || 0);
    var end = new Date(start.getTime() + 2 * 3600e3);
    var f = function (x) { return x.getFullYear() + pad(x.getMonth() + 1) + pad(x.getDate()) + "T" + pad(x.getHours()) + pad(x.getMinutes()) + "00"; };
    var title = (p ? p.title : e.note || "Спектакль") + " · " + (th.name || "Театр RAT");
    var loc = [e.venue || th.venue, th.address].filter(Boolean).join(", ");
    var ics = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Театр RAT//RU","BEGIN:VEVENT",
      "UID:" + e.date + "-" + (e.playId || "x") + "@rat-theater","DTSTAMP:" + f(new Date()) + "Z",
      "DTSTART;TZID=Europe/Moscow:" + f(start),"DTEND;TZID=Europe/Moscow:" + f(end),
      "SUMMARY:" + title.replace(/,/g, "\\,"),"LOCATION:" + loc.replace(/,/g, "\\,"),
      "URL:" + (ticket(e, p, th) || siteUrl()),"END:VEVENT","END:VCALENDAR"].join("\r\n");
    return "data:text/calendar;charset=utf-8," + encodeURIComponent(ics);
  }

  /* ---------- строка афиши ---------- */
  function eventRow(e, p, th, opts) {
    opts = opts || {};
    var dt = parseDate(e.date), u = ticket(e, p, th), sold = hasBadge(e, "soldout");
    var badges = (e.badges || []).filter(function (b) { return BADGES[b]; }).map(function (b) { return '<span class="badge ' + b + '">' + BADGES[b] + "</span>"; }).join("");
    var titleHtml = p ? (opts.link === false ? esc(p.title) : '<a href="' + playUrl(p) + '">' + esc(p.title) + "</a>") : esc(e.note || "Спектакль");
    return '<div class="ev rv' + (sold ? " sold" : "") + '"><span class="tape"></span>' + (badges ? '<div class="badges">' + badges + "</div>" : "") +
      '<div class="d"><b>' + dt.getDate() + "</b><span>" + MONTHS_SHORT[dt.getMonth()] + "</span><small>" + DAYS[dt.getDay()] + (e.time ? " · " + esc(e.time) : "") + "</small></div>" +
      '<div><h3 class="t">' + titleHtml + "</h3>" +
      '<div class="m"><b>' + esc(e.venue || th.venue || "") + "</b>" + (p && p.duration ? " · " + esc(p.duration) : "") + (p && p.age ? " · " + esc(p.age) : "") + (e.note && p ? " · " + esc(e.note) : "") + "</div>" +
      (e.price ? '<div class="p">' + esc(e.price) + "</div>" : "") + "</div>" +
      '<div class="buy">' + (sold ? '<span class="btn disabled">Билетов нет</span>' : (buyBtn(e, p, th, "Купить билет") || '<span class="btn disabled">Скоро в продаже</span>')) +
      '<a class="cal" href="' + icsHref(e, p, th) + '" download="' + esc((p ? p.title : "show") + "-" + e.date) + '.ics">+ в календарь</a></div></div>';
  }

  /* ---------- «Сегодня играем» ---------- */
  function todayBar(d, golosHref) {
    var box = document.getElementById("today"); if (!box) return;
    var map = byId(d), t = todayStr();
    var ev = d.events.filter(function (e) { return e.date === t; }).sort(function (a, b) { return (a.time || "").localeCompare(b.time || ""); })[0];
    if (!ev) { box.hidden = true; return; }
    var p = map[ev.playId], name = p ? p.title : (ev.note || "Спектакль");
    var hm = (ev.time || "19:00").split(":").map(Number);
    var tick = function () {
      var now = new Date(), start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm[0] || 19, hm[1] || 0);
      var diff = start - now, live = diff <= 0;
      box.className = "today" + (live ? " live" : "");
      var when = "";
      if (!live) { var h = Math.floor(diff / 3600e3), m = Math.floor(diff % 3600e3 / 60e3); when = h > 0 ? "через " + h + " ч " + m + " мин" : "через " + m + " мин"; }
      box.innerHTML = '<div class="wrap"><span class="lbl">' + (live ? "Спектакль идёт" : "Сегодня играем") + '</span>' +
        '<span class="txt"><b>' + esc(name) + "</b> · " + esc(ev.time || "") + " · " + esc(ev.venue || d.theatre.venue || "") + (when ? " · " + when : "") + "</span>" +
        (live ? '<a class="btn" href="' + (golosHref || "golos") + '">Голосуй рублём</a>'
              : (hasBadge(ev, "soldout") ? '<span class="btn disabled">Билетов нет</span>' : (buyBtn(ev, p, d.theatre, "Билеты") || '<a class="btn" href="#afisha">Билеты</a>'))) + "</div>";
      box.hidden = false;
    };
    tick(); setInterval(tick, 60e3);
  }

  /* ---------- поделиться ---------- */
  function shareHtml(url, title) {
    return '<div class="share"><span class="lbl">Поделиться</span>' +
      '<a class="btn ghost onDark sm" href="https://t.me/share/url?url=' + encodeURIComponent(url) + "&text=" + encodeURIComponent(title) + '" target="_blank" rel="noopener">Telegram</a>' +
      '<a class="btn ghost onDark sm" href="https://vk.com/share.php?url=' + encodeURIComponent(url) + "&title=" + encodeURIComponent(title) + '" target="_blank" rel="noopener">VK</a>' +
      '<button class="btn ghost onDark sm" data-copy="' + esc(url) + '">Скопировать ссылку</button></div>';
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-copy]"); if (!b) return;
    var done = function () { var t = b.textContent; b.textContent = "Скопировано ✓"; setTimeout(function () { b.textContent = t; }, 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(b.dataset.copy).then(done, function () { prompt("Ссылка:", b.dataset.copy); });
    else prompt("Ссылка:", b.dataset.copy);
  });

  /* ---------- труппа: карточки с переворотом ---------- */
  function actorCard(a) {
    return '<div class="flip rv" tabindex="0" role="button" aria-label="' + esc(a.name) + '"><div class="inner">' +
      '<div class="face front"><span class="tape"></span><div class="ph">' + (a.photo ? '<img src="' + esc(a.photo) + '" alt="' + esc(a.name) + '" loading="lazy">' : '<div class="in">' + esc(initials(a.name)) + "</div>") + "</div>" +
      '<div class="n">' + esc(a.name) + "</div>" + (a.bio ? '<div class="r">' + esc(a.bio) + "</div>" : "") + '<span class="hint">нажми ↻</span></div>' +
      '<div class="face back"><span class="big">' + esc(initials(a.name)) + '</span><div class="n">' + esc(a.name) + "</div>" +
      (a.roles ? '<div class="roles">' + esc(a.roles) + "</div>" : "") + '<div class="bio">' + esc(a.bio || "") + "</div>" + '<span class="hint">↻</span></div>' +
      "</div></div>";
  }
  document.addEventListener("click", function (e) { var f = e.target.closest && e.target.closest(".flip"); if (f) f.classList.toggle("on"); });
  document.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("flip")) { e.preventDefault(); e.target.classList.toggle("on"); } });

  /* ---------- отзывы ---------- */
  function reviewCard(r) {
    return '<div class="rev rv"><span class="tape"></span><span class="q">“</span><p>' + esc(r.text) + "</p>" +
      '<div class="who">' + esc(r.author || "Зритель") + (r.source ? (r.url ? '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.source) + "</a>" : '<a>' + esc(r.source) + "</a>") : "") + "</div></div>";
  }

  /* ---------- бэкстейдж ---------- */
  var ROT = [-3, 2, -1.5, 3, -2.5, 1, 2.5, -2];
  function shot(g, i) {
    return '<figure class="shot rv" style="transform:rotate(' + ROT[i % ROT.length] + 'deg);margin:0" data-src="' + esc(g.photo) + '" data-cap="' + esc(g.caption || "") + '"><span class="tape"></span><img src="' + esc(g.photo) + '" alt="' + esc(g.caption || "") + '" loading="lazy">' + (g.caption ? '<figcaption class="cap">' + esc(g.caption) + "</figcaption>" : "") + "</figure>";
  }
  function lightbox() {
    var lb = document.getElementById("lightbox"); if (!lb) return;
    document.addEventListener("click", function (e) {
      var s = e.target.closest && e.target.closest(".shot");
      if (s) { lb.querySelector("img").src = s.dataset.src; lb.querySelector(".cap").textContent = s.dataset.cap || ""; lb.classList.add("open"); return; }
      if (e.target === lb || e.target.closest("#lightbox")) lb.classList.remove("open");
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") lb.classList.remove("open"); });
  }

  /* ---------- появление при прокрутке ---------- */
  function reveal() {
    var els = document.querySelectorAll(".rv:not(.in)");
    var all = function () { els.forEach(function (el) { el.classList.add("in"); }); };
    if (!("IntersectionObserver" in window)) { all(); return; }
    var io = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }); }, { rootMargin: "0px 0px -6% 0px" });
    els.forEach(function (el) { io.observe(el); });
    setTimeout(all, 2500); // страховка: через 2,5 с показать всё, даже если наблюдатель не сработал
  }

  /* ---------- schema.org (если сервер не вставил свою) ---------- */
  function jsonLd(d) {
    if (document.querySelector('script[type="application/ld+json"]')) return;
    var th = d.theatre, map = byId(d), base = siteUrl();
    var events = upcoming(d).slice(0, 20).map(function (e) {
      var p = map[e.playId]; return {
        "@type": "TheaterEvent", "name": p ? p.title : (e.note || "Спектакль"), "startDate": e.date + "T" + (e.time || "19:00") + ":00+03:00",
        "eventStatus": "https://schema.org/EventScheduled", "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
        "location": { "@type": "Place", "name": e.venue || th.venue || "", "address": th.address || "" },
        "image": p && p.poster ? base + p.poster : undefined, "url": p ? base + playUrl(p) : base,
        "performer": { "@type": "TheaterGroup", "name": th.name || "Театр RAT" },
        "organizer": { "@type": "Organization", "name": th.name || "Театр RAT", "url": base },
        "offers": ticket(e, p, th) ? { "@type": "Offer", "url": ticket(e, p, th), "availability": hasBadge(e, "soldout") ? "https://schema.org/SoldOut" : "https://schema.org/InStock", "priceCurrency": "RUB" } : undefined
      };
    });
    var s = document.createElement("script"); s.type = "application/ld+json";
    s.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "TheaterGroup", "name": th.name || "Театр RAT", "url": base, "description": th.tagline || "" }].concat(events) });
    document.head.appendChild(s);
  }

  return { applyLeft: applyLeft, hit: hit, marqRat: marqRat, applyLive: applyLive, esc: esc, initials: initials, parseDate: parseDate, fmtLong: fmtLong, todayStr: todayStr, siteUrl: siteUrl, playUrl: playUrl, loadData: loadData, byId: byId, upcoming: upcoming, ticket: ticket, hasBadge: hasBadge, BADGES: BADGES,
    marquee: marquee, eventRow: eventRow, buyBtn: buyBtn, applyBuy: applyBuy, todayBar: todayBar, shareHtml: shareHtml, actorCard: actorCard, reviewCard: reviewCard, shot: shot, lightbox: lightbox, reveal: reveal, jsonLd: jsonLd };
})();
