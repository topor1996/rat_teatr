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
      /* черновики (галочка «скрыть» в админке) на сайт не попадают */
      d.plays = d.plays.filter(function (p) { return !p.hidden; });
      var visible = {}; d.plays.forEach(function (p) { visible[p.id] = true; p.media = (p.media || []).filter(function (m) { return !m.hidden; }); });
      d.events = d.events.filter(function (e) { return !e.hidden && (!e.playId || visible[e.playId]); });
      d.reviews = d.reviews.filter(function (r) { return !r.hidden && (!r.playId || visible[r.playId]); });
      d.gallery = d.gallery.filter(function (g) { return !g.hidden && (!g.playId || visible[g.playId]); });
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
    var run = function () { rat.classList.remove("run"); rat.classList.remove("dash"); rat.style.removeProperty("--x"); void rat.offsetWidth; rat.classList.add("run"); setTimeout(run, 40000 + Math.random() * 50000); };
    rat.addEventListener("click", function () {
      if (!rat.classList.contains("run") || rat.classList.contains("dash")) return;
      squeak();
      try { var tx = new DOMMatrixReadOnly(getComputedStyle(rat).transform).m41; rat.style.setProperty("--x", tx.toFixed(0) + "px"); } catch (x) {}
      rat.classList.add("dash");
    });
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
    var soon = (dt - new Date(new Date().toDateString())) / 864e5 < 3; // меньше трёх дней до показа
    var badges = (e.badges || []).filter(function (b) { return BADGES[b]; }).map(function (b) { return '<span class="badge ' + b + '">' + BADGES[b] + "</span>"; }).join("");
    var titleHtml = p ? (opts.link === false ? esc(p.title) : '<a href="' + playUrl(p) + '">' + esc(p.title) + "</a>") : esc(e.note || "Спектакль");
    return '<div class="ev rv' + (sold ? " sold" : "") + '"><span class="tape"></span>' + (badges ? '<div class="badges">' + badges + "</div>" : "") +
      '<div class="d"><b>' + dt.getDate() + "</b><span>" + MONTHS_SHORT[dt.getMonth()] + "</span><small>" + DAYS[dt.getDay()] + (e.time ? " · " + esc(e.time) : "") + "</small></div>" +
      '<div><h3 class="t">' + titleHtml + "</h3>" +
      '<div class="m"><b>' + esc(e.venue || th.venue || "") + "</b>" + (p && p.duration ? " · " + esc(p.duration) : "") + (p && p.age ? " · " + esc(p.age) : "") + (e.note && p ? " · " + esc(e.note) : "") + "</div>" +
      (e.price ? '<div class="p">' + esc(e.price) + "</div>" : "") + "</div>" +
      '<div class="buy">' + (sold ? waitBtn(e) : (buyBtn(e, p, th, "Купить билет", soon ? "soon" : "") || '<span class="btn disabled">Скоро в продаже</span>')) +
      '<a class="cal" href="' + icsHref(e, p, th) + '" download="' + esc((p ? p.title : "show") + "-" + e.date) + '.ics">+ в календарь</a>' + (sold ? "" : remindBtn(e)) + "</div></div>";
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
    return '<figure class="shot rv" style="transform:rotate(' + ROT[i % ROT.length] + 'deg);margin:0" data-src="' + esc(g.photo) + '" data-cap="' + esc(g.caption || "") + '"><span class="tape"></span><img src="' + esc(g.photo) + '" alt="' + esc(g.alt || g.caption || "") + '" loading="lazy">' + (g.caption ? '<figcaption class="cap">' + esc(g.caption) + "</figcaption>" : "") + "</figure>";
  }
  /* ---------- голоса актёров: аудио на странице спектакля ---------- */
  function voicesHtml(list) {
    return (list || []).map(function (v, i) {
      return '<div class="voice rv"><button class="vplay" type="button" aria-label="Слушать"><span class="ico"></span></button>' +
        '<div class="vbody"><div class="vname">' + esc(v.name || "Голос " + (i + 1)) + "</div>" + (v.note ? '<div class="vnote">' + esc(v.note) + "</div>" : "") +
        '<div class="vbar"><div class="vfill"></div></div></div><div class="vtime">–:––</div><audio preload="metadata" src="' + esc(v.audio) + '"></audio></div>';
    }).join("");
  }
  function voicePlayers(root) {
    var fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + s % 60; };
    var all = [].slice.call((root || document).querySelectorAll(".voice"));
    all.forEach(function (box) {
      var a = box.querySelector("audio"), btn = box.querySelector(".vplay"), fill = box.querySelector(".vfill"), time = box.querySelector(".vtime");
      btn.addEventListener("click", function () { if (a.paused) { all.forEach(function (o) { if (o !== box) o.querySelector("audio").pause(); }); a.play(); } else a.pause(); });
      a.addEventListener("play", function () { box.classList.add("playing"); });
      a.addEventListener("pause", function () { box.classList.remove("playing"); });
      a.addEventListener("ended", function () { box.classList.remove("playing"); fill.style.width = "0%"; time.textContent = fmt(a.duration); });
      a.addEventListener("loadedmetadata", function () { time.textContent = fmt(a.duration); });
      a.addEventListener("timeupdate", function () { if (a.duration) { fill.style.width = (a.currentTime / a.duration * 100) + "%"; time.textContent = fmt(a.duration - a.currentTime); } });
      box.querySelector(".vbar").addEventListener("click", function (e) { var r = e.currentTarget.getBoundingClientRect(); if (a.duration) a.currentTime = (e.clientX - r.left) / r.width * a.duration; });
    });
  }
  /* ---------- слайдер фото и видео спектакля ---------- */
  function mediaSlider(list) {
    list = list || [];
    var slides = list.map(function (m, i) {
      var cap = m.caption ? '<div class="scap">' + esc(m.caption) + "</div>" : "";
      if (m.type === "video") {
        /* видео не грузится, пока не нажали: показываем обложку (кадр из ролика) или тёмную заглушку */
        return '<div class="slide video" data-video="' + esc(m.src) + '"><div class="vwrap">' + (m.poster ? '<img src="' + esc(m.poster) + '" alt="' + esc(m.alt || m.caption || "Видео") + '" loading="' + (i < 2 ? "eager" : "lazy") + '"' + (i === 0 ? ' fetchpriority="high"' : "") + ">" : '<div class="vph"></div>') + '<button class="vbig" type="button" aria-label="Смотреть видео"></button></div>' + cap + "</div>";
      }
      return '<div class="slide shot" data-src="' + esc(m.src) + '" data-cap="' + esc(m.caption || "") + '"><img src="' + esc(m.src) + '" alt="' + esc(m.alt || m.caption || "") + '" loading="' + (i < 2 ? "eager" : "lazy") + '"' + (i === 0 ? ' fetchpriority="high"' : "") + ">" + cap + "</div>";
    }).join("");
    var all = list.length > 3 ? '<div class="sall-row"><button class="btn ghost onDark sall" type="button">Смотреть все фото</button></div>' : "";
    return '<div class="slider"><button class="snav prev" type="button" aria-label="Назад">‹</button><div class="strip">' + slides + '</div><button class="snav next" type="button" aria-label="Вперёд">›</button><div class="sdots"></div>' + all + "</div>";
  }
  function sliders(root) {
    [].slice.call((root || document).querySelectorAll(".slider")).forEach(function (sl) {
      var strip = sl.querySelector(".strip"), items = strip.children, dots = sl.querySelector(".sdots"), n = items.length;
      if (n < 2) { sl.querySelector(".prev").hidden = sl.querySelector(".next").hidden = true; }
      dots.innerHTML = Array.prototype.map.call(items, function (_, i) { return '<i' + (i ? "" : ' class="on"') + "></i>"; }).join("");
      var cur = function () { return Math.round(strip.scrollLeft / Math.max(1, items[0].offsetWidth + 14)); };
      var go = function (i) { i = Math.max(0, Math.min(n - 1, i)); strip.scrollTo({ left: i * (items[0].offsetWidth + 14), behavior: "smooth" }); };
      sl.querySelector(".prev").addEventListener("click", function () { go(cur() - 1); });
      sl.querySelector(".next").addEventListener("click", function () { go(cur() + 1); });
      strip.addEventListener("scroll", function () { var c = cur(); Array.prototype.forEach.call(dots.children, function (d, i) { d.className = i === c ? "on" : ""; }); [].forEach.call(strip.querySelectorAll("video"), function (v) { if (!v.paused && Array.prototype.indexOf.call(items, v.parentNode) !== c) v.pause(); }); }, { passive: true });
      dots.addEventListener("click", function (e) { var i = Array.prototype.indexOf.call(dots.children, e.target); if (i >= 0) go(i); });
      /* видео по клику: вместо обложки вставляем плеер и запускаем */
      sl.addEventListener("click", function (e) {
        var vb = e.target.closest && e.target.closest(".vbig"); if (!vb) return;
        var slide = vb.closest(".slide"), wrap = slide.querySelector(".vwrap");
        [].forEach.call(strip.querySelectorAll("video"), function (v) { v.pause(); });
        wrap.innerHTML = '<video controls autoplay playsinline preload="auto" src="' + slide.getAttribute("data-video") + '"></video>';
      });
      var sall = sl.querySelector(".sall");
      if (sall) sall.addEventListener("click", function () { var on = sl.classList.toggle("grid"); sall.textContent = on ? "Свернуть в ленту" : "Смотреть все фото"; if (!on) strip.scrollTo({ left: 0 }); });
    });
  }

  /* ---------- картинка «Я иду на спектакль» для сторис (1080×1920) ---------- */
  function loadImg(src) { return new Promise(function (res) { var i = new Image(); i.onload = function () { res(i); }; i.onerror = function () { res(null); }; i.src = src; }); }
  function wrapText(ctx, text, maxW, maxLines) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s?\S*$/, "") + "…"; }
    return lines;
  }
  function storyCard(p, ev, th) {
    var W = 1080, H = 1920;
    var fontsReady = document.fonts ? Promise.all([document.fonts.load('700 100px "Oswald"'), document.fonts.load('400 90px "Rubik Spray Paint"'), document.fonts.load('400 34px "PT Mono"')]).catch(function () {}) : Promise.resolve();
    return Promise.all([fontsReady, p.poster ? loadImg(p.poster) : null]).then(function (r) {
      var img = r[1], c = document.createElement("canvas"); c.width = W; c.height = H; var x = c.getContext("2d");
      x.fillStyle = "#0a0a0a"; x.fillRect(0, 0, W, H);
      var g = x.createRadialGradient(W, 0, 50, W, 0, 900); g.addColorStop(0, "rgba(201,255,61,.22)"); g.addColorStop(1, "rgba(201,255,61,0)"); x.fillStyle = g; x.fillRect(0, 0, W, H);
      var n = x.getImageData(0, 0, W, H), d = n.data; for (var i = 0; i < d.length; i += 4) { if (Math.random() < 0.05) { d[i] += 14; d[i + 1] += 14; d[i + 2] += 14; } } x.putImageData(n, 0, 0);
      x.save(); x.translate(90, 120); x.rotate(-0.04); x.strokeStyle = "#fff"; x.lineWidth = 5; x.strokeRect(0, 0, 340, 74); x.fillStyle = "#fff"; x.font = '600 32px "Oswald"'; x.textBaseline = "middle"; x.fillText((th.name || "ТЕАТР RAT").toUpperCase(), 26, 38); x.restore();
      var pw = 900, ph = 900, px = (W - pw) / 2, py = 250;
      x.save(); x.translate(px + pw / 2, py + ph / 2); x.rotate(-0.025); x.translate(-pw / 2, -ph / 2);
      x.fillStyle = "#f1eee4"; x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 40; x.shadowOffsetY = 20; x.fillRect(-16, -16, pw + 32, ph + 32); x.shadowColor = "transparent";
      if (img) { var s = Math.max(pw / img.width, ph / img.height), sw = pw / s, sh = ph / s; x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, pw, ph); }
      else { x.fillStyle = "#151515"; x.fillRect(0, 0, pw, ph); x.fillStyle = "#c9ff3d"; x.font = '400 110px "Rubik Spray Paint"'; x.textAlign = "center"; x.textBaseline = "middle"; var tl = wrapText(x, p.title.toUpperCase(), pw - 80, 3); tl.forEach(function (l, i) { x.fillText(l, pw / 2, ph / 2 + (i - (tl.length - 1) / 2) * 120); }); x.textAlign = "left"; }
      x.fillStyle = "rgba(255,236,150,.6)"; x.fillRect(pw / 2 - 90, -34, 180, 44);
      x.restore();
      var y = 1230; x.textBaseline = "alphabetic"; x.textAlign = "left";
      x.fillStyle = "#cfcbbd"; x.font = '400 38px "PT Mono"'; x.fillText("Я иду на спектакль", 90, y); y += 40;
      x.fillStyle = "#fff"; x.font = '700 104px "Oswald"'; wrapText(x, p.title.toUpperCase(), W - 180, 2).forEach(function (l) { y += 104; x.fillText(l, 90, y); });
      if (ev) { y += 110; x.save(); x.translate(90, y); x.rotate(-0.03); x.fillStyle = "#c9ff3d"; x.font = '400 80px "Rubik Spray Paint"'; x.fillText(fmtLong(ev).replace(" · ", "  "), 0, 0); x.restore(); }
      y += 70; x.fillStyle = "#cfcbbd"; x.font = '400 34px "PT Mono"'; wrapText(x, (ev && ev.venue) || th.venue || "", W - 180, 2).forEach(function (l) { x.fillText(l, 90, y); y += 44; });
      x.save(); x.translate(0, H - 150); x.rotate(-0.03); x.fillStyle = "#c9ff3d"; x.fillRect(-60, 0, W + 120, 96); x.fillStyle = "#000"; x.font = '700 40px "Oswald"'; x.textBaseline = "middle";
      var band = ((th.name || "Театр RAT") + "  ✦  " + siteUrl().replace(/^https?:\/\//, "") + "  ✦  Билеты на сайте  ✦  ").toUpperCase(); var bw = x.measureText(band).width, bx = -40; while (bx < W + 60) { x.fillText(band, bx, 48); bx += bw; }
      x.restore();
      return new Promise(function (res) { c.toBlob(function (b) { res(b); }, "image/jpeg", 0.9); });
    });
  }
  function storyButton(p, events, th) {
    if (!document.getElementById("story")) {
      var m = document.createElement("div"); m.id = "story"; m.className = "story";
      m.innerHTML = '<div class="sbox"><div class="shead"><b>Картинка для сторис</b><button class="sclose" type="button" aria-label="Закрыть">×</button></div><div class="sdate"></div><div class="spreview"><img alt="Превью"></div><div class="sbtns"><button class="btn share" type="button">Поделиться</button><a class="btn ghost dl" download="ya-idu.jpg">Скачать</a></div><p class="hint">Сохрани картинку и выложи в сторис. Формат 1080×1920.</p></div>';
      document.body.appendChild(m);
      m.addEventListener("click", function (e) { if (e.target === m || e.target.closest(".sclose")) m.classList.remove("open"); });
    }
    var modal = document.getElementById("story"), img = modal.querySelector("img"), dl = modal.querySelector(".dl"), share = modal.querySelector(".share"), sel = modal.querySelector(".sdate");
    var file = null;
    var build = function (ev) { img.removeAttribute("src"); storyCard(p, ev, th).then(function (b) { file = new File([b], "ya-idu-" + (p.id || "rat") + ".jpg", { type: "image/jpeg" }); img.src = URL.createObjectURL(b); dl.href = img.src; }); };
    sel.innerHTML = events.length > 1 ? '<select>' + events.slice(0, 12).map(function (e, i) { return '<option value="' + i + '">' + esc(fmtLong(e)) + "</option>"; }).join("") + "</select>" : (events[0] ? '<span>' + esc(fmtLong(events[0])) + "</span>" : "");
    var s = sel.querySelector("select"); if (s) s.onchange = function () { build(events[+s.value]); };
    share.hidden = !(navigator.share && navigator.canShare);
    share.onclick = function () { if (file && navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: p.title }).catch(function () {}); else if (dl.href) dl.click(); };
    build(events[0] || null); modal.classList.add("open");
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-story]"); if (b && window.__storyCtx) { e.preventDefault(); storyButton(window.__storyCtx.p, window.__storyCtx.events, window.__storyCtx.th); }
  });

  function lightbox() {
    var lb = document.getElementById("lightbox"); if (!lb) return;
    if (!lb.querySelector(".lnav")) lb.insertAdjacentHTML("beforeend", '<button class="lnav prev" type="button" aria-label="Назад">‹</button><button class="lnav next" type="button" aria-label="Вперёд">›</button><div class="lcount"></div><button class="lclose" type="button" aria-label="Закрыть">×</button>');
    var img = lb.querySelector("img"), cap = lb.querySelector(".cap"), count = lb.querySelector(".lcount"), list = [], idx = 0;
    var show = function (i) {
      if (!list.length) return; idx = (i + list.length) % list.length; var s = list[idx];
      img.src = s.dataset.src; cap.textContent = s.dataset.cap || ""; count.textContent = list.length > 1 ? (idx + 1) + " / " + list.length : "";
      lb.classList.toggle("single", list.length < 2);
      var n = list[(idx + 1) % list.length]; if (n && n !== s) { var pre = new Image(); pre.src = n.dataset.src; } /* следующее фото подгружаем заранее */
    };
    var close = function () { lb.classList.remove("open"); };
    document.addEventListener("click", function (e) {
      var s = e.target.closest && e.target.closest(".shot");
      if (s) { /* группа — все фото того же блока: слайдер, стена бэкстейджа, галерея */
        var group = s.closest(".strip, .wall, .gallery, section, main") || document;
        list = [].slice.call(group.querySelectorAll(".shot")); show(list.indexOf(s)); lb.classList.add("open"); return;
      }
      if (!lb.classList.contains("open")) return;
      if (e.target.closest(".lnav.prev")) { show(idx - 1); return; }
      if (e.target.closest(".lnav.next")) { show(idx + 1); return; }
      if (e.target === lb || e.target.closest(".lclose") || e.target === img) close();
    });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close(); else if (e.key === "ArrowLeft") show(idx - 1); else if (e.key === "ArrowRight") show(idx + 1);
    });
    var tx = null; lb.addEventListener("touchstart", function (e) { tx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) { if (tx === null) return; var dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) show(idx + (dx < 0 ? 1 : -1)); }, { passive: true });
  }

  /* ================= эффекты ================= */
  var reduced = function () { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); };

  /* глитч заголовков: текст оборачивается в .gt, сверху два клона-канала (.gl.r и .gl.c); тайминг задаёт CSS */
  function glitch() {
    if (reduced()) return;
    document.querySelectorAll("h2.sec").forEach(function (h, i) {
      if (h.querySelector(".gt")) return;
      var gt = document.createElement("span"); gt.className = "gt";
      Array.prototype.slice.call(h.childNodes).forEach(function (n) { if (!(n.nodeType === 1 && n.classList.contains("stamp-deco"))) gt.appendChild(n); });
      h.insertBefore(gt, h.firstChild); h.classList.add("gx");
      h.style.setProperty("--gd", (i * 1.9 + Math.random() * 4).toFixed(1) + "s");
      h.insertAdjacentHTML("beforeend", '<span class="gl r" aria-hidden="true">' + gt.innerHTML + '</span><span class="gl c" aria-hidden="true">' + gt.innerHTML + "</span>");
    });
  }

  /* след баллончика за курсором — только мышь, не на тач-экранах */
  function spray() {
    if (reduced() || !(window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches)) return;
    var pool = [], n = 18, i = 0, last = 0;
    for (var k = 0; k < n; k++) { var d = document.createElement("i"); d.className = "spray"; document.body.appendChild(d); pool.push(d); }
    window.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var now = performance.now(); if (now - last < 26) return; last = now;
      var d = pool[i++ % n]; d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px"; d.style.setProperty("--s", (5 + Math.random() * 9).toFixed(0) + "px");
      d.classList.remove("on"); void d.offsetWidth; d.classList.add("on");
    }, { passive: true });
  }

  /* живая лента: базовая скорость 80 px/с, прокрутка страницы разгоняет, в покое затухает */
  function marqLive() {
    var m = document.querySelector(".marq"); if (!m || reduced() || m.classList.contains("js")) return;
    var tracks = m.querySelectorAll(".track"); if (tracks.length < 2 || !window.requestAnimationFrame) return;
    var w = tracks[0].getBoundingClientRect().width; if (!w) return;
    m.classList.add("js");
    var x = 0, boost = 0, last = performance.now(), lastY = window.pageYOffset;
    var measure = function () { var nw = tracks[0].getBoundingClientRect().width; if (nw) w = nw; };
    window.addEventListener("resize", measure); if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(tracks[0]);
    window.addEventListener("scroll", function () { var y = window.pageYOffset; boost = Math.min(boost + Math.abs(y - lastY) * 2.2, 1400); lastY = y; }, { passive: true });
    var tick = function (now) {
      var dt = Math.min((now - last) / 1000, .05); last = now;
      x -= (80 + boost) * dt; boost *= Math.pow(.04, dt);
      if (x <= -w) x += w;
      var t = "translate3d(" + x.toFixed(2) + "px,0,0)"; tracks[0].style.transform = t; tracks[1].style.transform = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* писк крысы: две короткие трели, синтез без файлов */
  function squeak() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      var ac = squeak.ac || (squeak.ac = new AC()); if (ac.state === "suspended") ac.resume();
      [0, .13].forEach(function (off) {
        var o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + off;
        o.type = "square"; o.frequency.setValueAtTime(2300, t); o.frequency.exponentialRampToValueAtTime(3900, t + .05); o.frequency.exponentialRampToValueAtTime(2500, t + .11);
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.07, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
        o.connect(g); g.connect(ac.destination); o.start(t); o.stop(t + .13);
      });
    } catch (x) {}
  }

  /* ---------- уведомления: «напомнить», лист ожидания, PWA ---------- */
  var evKey = function (e) { return (e.date || "") + "_" + (e.time || "") + "_" + (e.playId || ""); };
  var pushOk = function () { return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; };
  var pushState = function () { try { return JSON.parse(localStorage.getItem("rat_push") || "{}"); } catch (x) { return {}; } };
  var pushMark = function (kind, key) { var s = pushState(); s[kind] = s[kind] || {}; s[kind][key] = 1; try { localStorage.setItem("rat_push", JSON.stringify(s)); } catch (x) {} };
  var pushHas = function (kind, key) { var s = pushState(); return !!(s[kind] && s[kind][key]); };
  function toast(msg, err) {
    var t = document.querySelector(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.toggle("err", !!err); t.classList.add("on");
    clearTimeout(toast.tm); toast.tm = setTimeout(function () { t.classList.remove("on"); }, 4200);
  }
  function apiJson(phpQ, nodePath, opts) {
    var chk = function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); };
    return fetch("api.php?a=" + phpQ, opts).then(function (r) { if (r.status === 404 || (r.headers.get("content-type") || "").indexOf("json") < 0) throw 0; return chk(r); })
      .catch(function (err) { if (err instanceof Error) throw err; return fetch("api/" + nodePath, opts).then(chk); });
  }
  var b64u8 = function (s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  function swReady() { return navigator.serviceWorker.register("sw.js").then(function () { return navigator.serviceWorker.ready; }); }
  function pushSubscribe() {
    if (!pushOk()) {
      var ios = /iP(hone|ad)/.test(navigator.userAgent) && !navigator.standalone;
      return Promise.reject(new Error(ios ? "На iPhone сначала добавьте сайт на экран «Домой»: Поделиться → На экран «Домой». Потом нажмите ещё раз." : "Этот браузер не умеет уведомления"));
    }
    return swReady().then(function (reg) {
      return Notification.requestPermission().then(function (perm) {
        if (perm !== "granted") throw new Error("Вы запретили уведомления в браузере");
        return reg.pushManager.getSubscription().then(function (s) {
          if (s) return s;
          return apiJson("push_key", "push_key").then(function (k) { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(k.key) }); });
        });
      });
    });
  }
  function pushWant(kind, key) {
    return pushSubscribe().then(function (sub) {
      return apiJson("push_sub", "push_sub", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sub: sub.toJSON(), kind: kind, key: key }) });
    }).then(function () { pushMark(kind, key); });
  }
  function remindBtn(e) {
    if (!("serviceWorker" in navigator)) return "";
    var k = evKey(e), on = pushHas("remind", k);
    return '<button type="button" class="cal rem' + (on ? " on" : "") + '" data-remind="' + esc(k) + '">' + (on ? "✓ напомню за день" : "🔔 напомнить за день") + "</button>";
  }
  function waitBtn(e) {
    var k = evKey(e), on = pushHas("wait", k);
    return '<button type="button" class="btn wait' + (on ? " on" : "") + '" data-wait="' + esc(k) + '">Билетов нет<small>' + (on ? "сообщу, если появятся ✓" : "сообщить, если появятся") + "</small></button>";
  }
  function waitDialog(key, btn) {
    var box = document.createElement("div"); box.className = "wl";
    box.innerHTML = '<div class="box"><button class="x" type="button" aria-label="Закрыть">×</button><h3>Если билеты появятся</h3><p>Иногда бронь снимают за день-два до показа. Скажем сразу, как только места вернутся в продажу.</p>' +
      ('serviceWorker' in navigator ? '<button type="button" class="btn" data-wl-push>🔔 Сообщить в браузере</button>' : "") +
      '<input type="email" placeholder="или на почту: you@mail.ru" autocomplete="email"><button type="button" class="btn" data-wl-mail>Написать на почту</button></div>';
    document.body.appendChild(box);
    var close = function () { box.remove(); };
    box.addEventListener("click", function (ev) { if (ev.target === box || ev.target.closest(".x")) close(); });
    var done = function () { pushMark("wait", key); if (btn) { btn.classList.add("on"); btn.querySelector("small").textContent = "сообщу, если появятся ✓"; } close(); toast("Договорились: сообщим, как только появятся билеты"); };
    var pb = box.querySelector("[data-wl-push]"); if (pb) pb.onclick = function () { pb.disabled = true; pushWant("wait", key).then(done).catch(function (err) { pb.disabled = false; toast(err.message || "Не получилось", true); }); };
    box.querySelector("[data-wl-mail]").onclick = function () {
      var em = box.querySelector("input").value.trim(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast("Проверьте адрес почты", true); return; }
      apiJson("waitlist", "waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: em, key: key }) }).then(done).catch(function (err) { toast(err.message || "Не получилось", true); });
    };
  }
  function pushInit() {
    document.addEventListener("click", function (ev) {
      var r = ev.target.closest("[data-remind]");
      if (r) {
        if (r.classList.contains("on")) { toast("Уже напомним за день до показа"); return; }
        r.disabled = true;
        pushWant("remind", r.dataset.remind).then(function () { r.classList.add("on"); r.textContent = "✓ напомню за день"; toast("Напомним за день до показа"); })
          .catch(function (err) { toast(err.message || "Не получилось включить напоминание", true); }).then(function () { r.disabled = false; });
        return;
      }
      var w = ev.target.closest("[data-wait]"); if (w) waitDialog(w.dataset.wait, w);
    });
    // офлайн-афиша (PWA): регистрируем service worker сразу, кнопка «Установить» появится, если браузер разрешит
    if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("sw.js").catch(function () {});
    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault(); deferred = e;
      if (document.querySelector(".pwa-btn")) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "btn pwa-btn"; b.textContent = "📱 Установить как приложение"; document.body.appendChild(b);
      b.onclick = function () { if (!deferred) return; deferred.prompt(); deferred.userChoice.then(function () { b.remove(); deferred = null; }); };
    });
  }
  function fx() { glitch(); spray(); marqLive(); }

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
  function mediaLd(p, base) {
    var out = [];
    (p.media || []).forEach(function (m) {
      var ts = (m.src.match(/\/(\d{10})-/) || [])[1], up = ts ? new Date(ts * 1000).toISOString().slice(0, 10) : undefined;
      if (m.type === "video") out.push({ "@type": "VideoObject", "name": m.caption || ("Видео: " + p.title), "description": m.alt || ("Видео со спектакля «" + p.title + "»"), "thumbnailUrl": base + (m.poster || (p.poster || "assets/og-cover.png")), "contentUrl": base + m.src, "uploadDate": up, "inLanguage": "ru" });
      else out.push({ "@type": "ImageObject", "contentUrl": base + m.src, "name": m.caption || p.title, "caption": m.alt || m.caption || p.title, "representativeOfPage": false });
    });
    if (p.poster) out.unshift({ "@type": "ImageObject", "contentUrl": base + p.poster, "name": p.title, "caption": "Постер спектакля «" + p.title + "»", "representativeOfPage": true });
    return out;
  }
  function jsonLd(d, play) {
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
    var graph = [{ "@type": "TheaterGroup", "name": th.name || "Театр RAT", "url": base, "description": th.tagline || "" }].concat(events);
    if (play) graph = graph.concat(mediaLd(play, base));
    s.textContent = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
    document.head.appendChild(s);
  }

  return { fx: fx, pushInit: pushInit, evKey: evKey, toast: toast, squeak: squeak, storyButton: storyButton, mediaSlider: mediaSlider, sliders: sliders, voicesHtml: voicesHtml, voicePlayers: voicePlayers, applyLeft: applyLeft, hit: hit, marqRat: marqRat, applyLive: applyLive, esc: esc, initials: initials, parseDate: parseDate, fmtLong: fmtLong, todayStr: todayStr, siteUrl: siteUrl, playUrl: playUrl, loadData: loadData, byId: byId, upcoming: upcoming, ticket: ticket, hasBadge: hasBadge, BADGES: BADGES,
    marquee: marquee, eventRow: eventRow, buyBtn: buyBtn, applyBuy: applyBuy, todayBar: todayBar, shareHtml: shareHtml, actorCard: actorCard, reviewCard: reviewCard, shot: shot, lightbox: lightbox, reveal: reveal, jsonLd: jsonLd };
})();
