// Сервер лендинга «Голосуй рублём»: отдаёт сайт, хранит данные и фото, даёт админку.
// Запуск: ADMIN_PASSWORD=секрет node server.js   (порт — переменная PORT, по умолчанию 3000)
const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const HISTORY_DIR = path.join(DATA_DIR, "history");
const VISITS_FILE = path.join(DATA_DIR, "visits.json");
const PW_FILE = path.join(DATA_DIR, "password.json");
const pwHash = () => { try { return JSON.parse(fs.readFileSync(PW_FILE, "utf8")).hash || ""; } catch { return ""; } };
const pwVerify = (given, hash) => { const [, salt, h] = hash.split("$"); const k = crypto.scryptSync(given, salt, 32).toString("hex"); return k.length === h.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(h)); };
const pwMake = pw => { const salt = crypto.randomBytes(12).toString("hex"); return "scrypt$" + salt + "$" + crypto.scryptSync(pw, salt, 32).toString("hex"); };
const PHOTOS_DIR = path.join(ROOT, "photos");
const PORT = process.env.PORT || 3000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });
fs.mkdirSync(HISTORY_DIR, { recursive: true });

// ---------- пароль админки ----------
let PASSWORD = process.env.ADMIN_PASSWORD;
if (!PASSWORD) {
  const pwFile = path.join(DATA_DIR, "password.txt");
  if (!fs.existsSync(pwFile)) {
    fs.writeFileSync(pwFile, crypto.randomBytes(9).toString("base64url"), { mode: 0o600 });
    console.log(`Пароль админки сгенерирован и сохранён в ${pwFile}`);
  }
  PASSWORD = fs.readFileSync(pwFile, "utf8").trim();
}

// ---------- данные ----------
function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { show: { theatre: "", title: "", dates: "" }, actors: [] }; }
}
function writeData(data) {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const str = (v, max = 500) => String(v ?? "").trim().slice(0, max);
const url = v => /^https?:\/\/\S+$/.test(str(v)) ? str(v) : "";
const img = v => /^photos\/[\w.-]+$/.test(str(v)) ? str(v) : "";
const media = v => /^photos\/[\w.-]+$/.test(str(v)) ? str(v) : "";
function sanitize(input) {
  const show = input.show || {}, th = input.theatre || {};
  const arr = v => (Array.isArray(v) ? v : []);
  const BADGES = ["premiere", "last", "few", "soldout"];
  const actors = arr(input.actors).slice(0, 50).map(a => ({
    name: str(a.name, 100), golos: !("golos" in a) || !!a.golos, role: str(a.role, 100), scene: str(a.scene, 400), bio: str(a.bio, 600), roles: str(a.roles, 300),
    photo: img(a.photo), sbp: url(a.sbp), phone: str(a.phone, 30), bank: str(a.bank, 60),
  })).filter(a => a.name);
  const plays = arr(input.plays).slice(0, 50).map((p, i) => ({
    id: str(p.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "") || "play-" + (i + 1),
    title: str(p.title, 100), genre: str(p.genre, 120), description: str(p.description, 3000),
    hidden: !!p.hidden, poster: img(p.poster), duration: str(p.duration, 40), age: str(p.age, 6), cast: str(p.cast, 500), ticketUrl: url(p.ticketUrl), afishaShowId: str(p.afishaShowId, 40).replace(/\D/g, ""), voices: arr(p.voices).slice(0, 10).map(x => ({ name: str(x.name, 100), note: str(x.note, 200), audio: media(x.audio) })).filter(x => x.audio), media: arr(p.media).slice(0, 40).map(x => ({ src: media(x.src), caption: str(x.caption, 140), alt: str(x.alt, 200), poster: img(x.poster), hidden: !!x.hidden })).filter(x => x.src).map(x => ({ type: /\.(mp4|webm|mov)$/i.test(x.src) ? "video" : "photo", ...x })),
  })).filter(p => p.title);
  const events = arr(input.events).slice(0, 200).map(e => ({
    date: str(e.date, 10), time: str(e.time, 5), playId: str(e.playId, 40), venue: str(e.venue, 120),
    hidden: !!e.hidden, price: str(e.price, 40), ticketUrl: url(e.ticketUrl), afishaSessionId: str(e.afishaSessionId, 40).replace(/\D/g, ""), note: str(e.note, 120), badges: arr(e.badges).filter(b => BADGES.includes(b)),
  })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  const reviews = arr(input.reviews).slice(0, 100).map(r => ({ hidden: !!r.hidden, text: str(r.text, 800), author: str(r.author, 100), source: str(r.source, 100), url: url(r.url), playId: str(r.playId, 40), ...(r.fromSite ? { fromSite: true, id: str(r.id, 40).replace(/[^\w-]/g, ""), date: str(r.date, 10) } : {}) })).filter(r => r.text);
  const gallery = arr(input.gallery).slice(0, 200).map(g => ({ photo: img(g.photo), video: media(g.video), poster: img(g.poster), caption: str(g.caption, 140), alt: str(g.alt, 200), playId: str(g.playId, 40), hidden: !!g.hidden, actors: arr(g.actors).slice(0, 20).map(n => str(n, 100)).filter(Boolean) })).filter(g => g.photo || g.video);
  return {
    theatre: { name: str(th.name, 100), tagline: str(th.tagline, 200), about: str(th.about, 3000), venue: str(th.venue, 120), address: str(th.address, 200),
               instagram: url(th.instagram), telegram: url(th.telegram), vk: url(th.vk), email: str(th.email, 100), phone: str(th.phone, 30), ticketsUrl: url(th.ticketsUrl),
               heroVideo: media(th.heroVideo), heroPoster: img(th.heroPoster), mapCoords: str(th.mapCoords, 40), marquee: str(th.marquee, 300), afishaPartnerId: str(th.afishaPartnerId, 20).replace(/\D/g, "") },
    plays, events, reviews, gallery,
    show: { theatre: str(show.theatre, 100), title: str(show.title, 100), dates: str(show.dates, 100), heading1: str(show.heading1, 40), heading2: str(show.heading2, 40), lead: str(show.lead, 400), marquee: str(show.marquee, 300), thanks: str(show.thanks, 80), thanksNote: str(show.thanksNote, 200) },
    actors,
  };
}

// ---------- сессии ----------
const sessions = new Map();               // token -> expires
const SESSION_TTL = 1000 * 60 * 60 * 24 * 14;
const loginAttempts = new Map();          // ip -> {count, until}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").map(c => c.trim().split("=")).filter(p => p[0]));
}
function isAuthed(req) {
  const t = parseCookies(req).rat_admin;
  const exp = t && sessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { sessions.delete(t); return false; }
  return true;
}
function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  res.status(401).json({ error: "unauthorized" });
}
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- загрузка фото ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: PHOTOS_DIR,
    filename: (req, file, cb) => {
      const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/x-m4a": ".m4a", "audio/aac": ".aac", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav" }[file.mimetype] || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^(image\/(jpeg|png|webp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|x-m4a|aac|ogg|wav|x-wav))$/.test(file.mimetype)),
});

// ---------- приложение ----------
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.get("/golos", (req, res) => res.sendFile(path.join(ROOT, "golos.html")));
app.use("/assets", express.static(path.join(ROOT, "assets"), { maxAge: "1d" }));
app.use("/fonts", express.static(path.join(ROOT, "fonts"), { maxAge: "30d" }));
app.use("/vendor", express.static(path.join(ROOT, "vendor"), { maxAge: "30d" }));
app.get("/play.html", (req, res) => res.sendFile(path.join(ROOT, "play.html")));
app.get("/data/data.json", (req, res) => { res.set("Cache-Control", "no-store"); res.json(readData()); });
app.use("/photos", express.static(PHOTOS_DIR, { maxAge: "1d" }));

app.get("/api/data", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readData());
});

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const att = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (att.until > Date.now()) return res.status(429).json({ error: "Слишком много попыток, подождите минуту" });
  const h = pwHash();
  if (h ? pwVerify(req.body?.password || "", h) : safeEqual(req.body?.password || "", PASSWORD)) {
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(24).toString("base64url");
    sessions.set(token, Date.now() + SESSION_TTL);
    res.set("Set-Cookie", `rat_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`);
    return res.json({ ok: true });
  }
  att.count++;
  if (att.count >= 5) { att.count = 0; att.until = Date.now() + 60_000; }
  loginAttempts.set(ip, att);
  res.status(401).json({ error: "Неверный пароль" });
});
app.post("/api/password", requireAuth, (req, res) => {
  const cur = str(req.body?.current, 200), next = str(req.body?.next, 200), h = pwHash();
  if (!(h ? pwVerify(cur, h) : safeEqual(cur, PASSWORD))) return res.status(401).json({ error: "Текущий пароль неверный" });
  if (next.length < 8) return res.status(400).json({ error: "Новый пароль короче 8 символов" });
  if (next === cur) return res.status(400).json({ error: "Новый пароль совпадает с текущим" });
  writeJson(PW_FILE, { hash: pwMake(next), changed: new Date().toISOString() }); res.json({ ok: true });
});
app.post("/api/logout", (req, res) => {
  sessions.delete(parseCookies(req).rat_admin);
  res.set("Set-Cookie", "rat_admin=; Path=/; HttpOnly; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ authed: isAuthed(req) }));

const snapshot = () => { try { if (!fs.existsSync(DATA_FILE)) return; fs.copyFileSync(DATA_FILE, path.join(HISTORY_DIR, new Date().toISOString().replace(/[:T.]/g, "-").slice(0, 23) + ".json")); const files = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort(); while (files.length > 20) fs.unlinkSync(path.join(HISTORY_DIR, files.shift())); } catch {} };
const readJson = (f, d) => { try { return { ...d, ...JSON.parse(fs.readFileSync(f, "utf8")) }; } catch { return d; } };
const writeJson = (f, v) => { fs.writeFileSync(f + ".tmp", JSON.stringify(v)); fs.renameSync(f + ".tmp", f); };
app.put("/api/data", requireAuth, (req, res) => {
  const data = sanitize(req.body || {});
  const since = +req.query.since || 0; // отзывы с сайта, пришедшие пока админка была открыта, не затираем
  if (since) { const have = new Set(data.reviews.map(r => r.id).filter(Boolean)); for (const r of readData().reviews || []) if (r.fromSite && r.id && !have.has(r.id) && +r.id.slice(1, 11) > since) data.reviews.push(r); }
  snapshot(); writeData(data);
  res.json({ ok: true, data });
});
const reviewRate = new Map();
app.post("/api/review", (req, res) => {
  const b = req.body || {};
  if (String(b.site || "").trim()) return res.json({ ok: true });
  const text = str(b.text, 800), author = str(b.author, 60), playId = str(b.playId, 40).replace(/[^\w-]/g, "");
  if (text.length < 20) return res.status(400).json({ error: "Напишите хотя бы пару предложений" });
  if (/https?:\/\/|www\./i.test(text)) return res.status(400).json({ error: "Ссылки в отзывах не публикуем" });
  const day = new Date().toISOString().slice(0, 10), rk = day + "-" + crypto.createHash("sha256").update((req.ip || "") + "|" + (req.headers["user-agent"] || "")).digest("hex").slice(0, 12);
  if ((reviewRate.get(rk) || 0) >= 5) return res.status(429).json({ error: "Слишком много отзывов за день, спасибо! Остальное — завтра" });
  reviewRate.set(rk, (reviewRate.get(rk) || 0) + 1);
  const data = readData(); (data.reviews = data.reviews || []).push({ text, author, source: "с сайта", url: "", playId, hidden: true, fromSite: true, id: "r" + Math.floor(Date.now() / 1000) + "-" + crypto.randomBytes(2).toString("hex"), date: day });
  writeData(data); res.json({ ok: true });
});
app.get("/api/snapshot", requireAuth, (req, res) => {
  const id = String(req.query.id || "").replace(/[^0-9.-]/g, "").replace(/\.\./g, ""), p = path.join(HISTORY_DIR, id + ".json");
  if (!id || !fs.existsSync(p)) return res.status(404).json({ error: "Версия не найдена" });
  try { res.json({ ok: true, data: JSON.parse(fs.readFileSync(p, "utf8")) }); } catch { res.status(500).json({ error: "Файл версии повреждён" }); }
});
app.get("/calendar.ics", (req, res) => {
  // живой календарь: как calendar.php
  const d = readData(), th = d.theatre || {}, name = th.name || "Театр RAT", plays = Object.fromEntries((d.plays || []).filter(p => !p.hidden).map(p => [p.id, p]));
  const base = siteBase(req), esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const z = dt => dt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//" + esc(name) + "//RU", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(name), "X-WR-TIMEZONE:Europe/Moscow", "X-PUBLISHED-TTL:PT6H", "REFRESH-INTERVAL;VALUE=DURATION:PT6H"];
  for (const e of d.events || []) {
    if (e.hidden || !e.date || e.date < since || (e.playId && !plays[e.playId])) continue;
    const p = plays[e.playId], title = p ? p.title : (e.note || "Спектакль"), time = e.time || "19:00";
    const start = new Date(e.date + "T" + time + ":00+03:00"); let mins = 90; const m = /(\d+)\s*час/.exec(p?.duration || ""), mm = /(\d+)\s*мин/.exec(p?.duration || ""); if (m) mins = +m[1] * 60 + (mm ? +mm[1] : 0); else if (mm) mins = +mm[1];
    const end = new Date(start.getTime() + mins * 6e4), url = p ? base + "play.html?id=" + encodeURIComponent(p.id) : base, ticket = e.ticketUrl || p?.ticketUrl || th.ticketsUrl || "";
    L.push("BEGIN:VEVENT", "UID:" + e.date + "-" + time.replace(":", "") + "-" + (e.playId || "show") + "@" + req.get("host"), "DTSTAMP:" + z(new Date()), "DTSTART:" + z(start), "DTEND:" + z(end),
      "SUMMARY:" + esc((e.badges || []).includes("soldout") ? "[аншлаг] " : "") + esc(title + " — " + name), "LOCATION:" + esc((e.venue || th.venue || "") + (th.address ? ", " + th.address : "")),
      "DESCRIPTION:" + esc([p?.genre, p ? (p.description || "").slice(0, 300) : "", e.note, ticket ? "Билеты: " + ticket : "", url].filter(Boolean).join("\n")), "URL:" + url, "STATUS:CONFIRMED", "BEGIN:VALARM", "TRIGGER:-PT24H", "ACTION:DISPLAY", "DESCRIPTION:" + esc("Завтра: " + title), "END:VALARM", "END:VEVENT");
  }
  const fold = line => { let out = ""; while (Buffer.byteLength(line) > 74) { let n = 74; while (Buffer.byteLength(line.slice(0, n)) > 74) n--; out += line.slice(0, n) + "\r\n "; line = line.slice(n); } return out + line; };
  L.push("END:VCALENDAR"); res.set("Content-Type", "text/calendar; charset=utf-8").send(L.map(fold).join("\r\n") + "\r\n");
});
app.get("/api/history", requireAuth, (req, res) => {
  const items = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith(".json")).sort().reverse().map(f => { const p = path.join(HISTORY_DIR, f); let j = {}; try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch {} const st = fs.statSync(p); return { id: f.replace(/\.json$/, ""), time: Math.floor(st.mtimeMs / 1000), size: st.size, actors: (j.actors || []).length, events: (j.events || []).length, plays: (j.plays || []).length, reviews: (j.reviews || []).length, gallery: (j.gallery || []).length }; });
  res.json({ ok: true, items });
});
app.post("/api/restore", requireAuth, (req, res) => {
  const id = str(req.body?.id, 40).replace(/[^0-9-]/g, ""); const f = path.join(HISTORY_DIR, id + ".json");
  if (!id || !fs.existsSync(f)) return res.status(400).json({ error: "Версия не найдена" });
  let j; try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { return res.status(400).json({ error: "Файл версии повреждён" }); }
  snapshot(); writeData(sanitize(j)); res.json({ ok: true, data: readData() });
});
app.get("/api/backup", requireAuth, (req, res) => {
  // zip без сжатия (store), без внешних зависимостей
  const files = []; const walk = (dir, base) => { for (const n of fs.readdirSync(dir)) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p, base + n + "/"); else if (!["password.txt", "password.json", "push-keys.json", "push.json", "waitlist.json"].includes(n)) files.push([base + n, fs.readFileSync(p)]); } };
  walk(DATA_DIR, "data/"); walk(PHOTOS_DIR, "photos/");
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = b => { let c = 0xFFFFFFFF; for (const x of b) c = crcTable[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], central = []; let offset = 0;
  const d = new Date(), dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const [name, buf] of files) {
    const n = Buffer.from(name), crc = crc32(buf);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(0, 8); lh.writeUInt16LE(dosTime, 10); lh.writeUInt16LE(dosDate, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(buf.length, 18); lh.writeUInt32LE(buf.length, 22); lh.writeUInt16LE(n.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(0, 10); ch.writeUInt16LE(dosTime, 12); ch.writeUInt16LE(dosDate, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(buf.length, 20); ch.writeUInt32LE(buf.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, n, buf); central.push(ch, n); offset += lh.length + n.length + buf.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  res.set("Content-Type", "application/zip").set("Content-Disposition", `attachment; filename="rat-theater-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip"`).send(Buffer.concat([...parts, cd, end]));
});
app.get("/api/sizes", requireAuth, (req, res) => { const sizes = {}; for (const n of fs.readdirSync(PHOTOS_DIR)) { const p = path.join(PHOTOS_DIR, n); if (fs.statSync(p).isFile()) sizes["photos/" + n] = fs.statSync(p).size; } res.json({ ok: true, sizes }); });
app.get("/api/hit", (req, res) => {
  const page = str(req.query.p, 60).toLowerCase().replace(/[^a-z0-9:_-]/g, ""); if (!page) return res.status(400).json({ error: "no page" });
  const day = today(), h = crypto.createHash("sha256").update(`${req.ip}|${req.headers["user-agent"] || ""}|${day}`).digest("hex").slice(0, 12);
  const v = readJson(VISITS_FILE, { days: {}, seen: {} });
  v.days[day] ||= {}; v.days[day][page] ||= { views: 0, uniq: 0 }; v.days[day][page].views++;
  v.seen = { [day]: v.seen[day] || {} }; v.seen[day][page] ||= {};
  if (!v.seen[day][page][h]) { v.seen[day][page][h] = 1; v.days[day][page].uniq++; }
  writeJson(VISITS_FILE, v); res.json({ ok: true });
});
app.get("/api/visits", requireAuth, (req, res) => { const v = readJson(VISITS_FILE, { days: {} }); res.json({ ok: true, days: Object.fromEntries(Object.entries(v.days).sort().reverse()) }); });

app.post("/api/upload", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нужен файл JPG, PNG или WebP до 8 МБ" });
  res.json({ ok: true, photo: `photos/${req.file.filename}` });
});

// ---------- Афиша: остатки мест и импорт дат ----------
const STATUS_FILE = path.join(DATA_DIR, "afisha-status.json");
const httpGet = async (u) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (rat-theater site)" }, signal: AbortSignal.timeout(15000) }); if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); };
const afishaShow = async (partner, showId) => { const j = JSON.parse(await httpGet(`https://tickets.afisha.ru/wl/${partner}/api/shows/info?lang=ru&show_id=${showId}`)); return j && j.show ? j.show : null; };
const afishaEvents = show => (show.events || []).filter(e => e.id && e.date).map(e => ({ sessionId: String(e.id), date: e.date.slice(0, 10), time: e.date.slice(11, 16), venue: String(e.location_name || "").trim(), count: Number(e.count || 0), minPrice: Math.round(Number(e.min_price || 0)), maxPrice: Math.round(Number(e.max_price || 0)) }));
app.get("/api/afisha_status", async (req, res) => {
  let cache = null; try { cache = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8")); } catch {}
  if (cache && Date.now() / 1000 - (cache.updated || 0) < 600 && !req.query.force) return res.json(cache);
  const data = readData(); const partner = str(data.theatre?.afishaPartnerId, 20).replace(/\D/g, "");
  const sessions = {}; let ok = false;
  if (partner) for (const sid of new Set((data.plays || []).map(p => str(p.afishaShowId, 40).replace(/\D/g, "")).filter(Boolean))) {
    try { const show = await afishaShow(partner, sid); if (!show) continue; ok = true; for (const e of afishaEvents(show)) sessions[e.sessionId] = { count: e.count, minPrice: e.minPrice, date: e.date, time: e.time }; } catch {}
  }
  if (!ok) return res.json(cache || { ok: false, updated: 0, sessions: {} });
  const out = { ok: true, updated: Math.floor(Date.now() / 1000), sessions }; try { fs.writeFileSync(STATUS_FILE, JSON.stringify(out)); } catch {}
  res.json(out);
});
app.get("/api/afisha_shows", requireAuth, async (req, res) => {
  try { const partner = str(readData().theatre?.afishaPartnerId, 20).replace(/\D/g, "") || "37"; const j = JSON.parse(await httpGet(`https://tickets.afisha.ru/wl/${partner}/api/shows?lang=ru`));
    res.json({ ok: true, shows: (j.shows || []).filter(s => s.id).map(s => ({ id: String(s.id), name: String(s.name || ""), image: String(s.image || ""), age: Number(s.age_limit || 0) })) }); }
  catch (e) { res.status(502).json({ error: "Афиша не ответила: " + e.message }); }
});
app.get("/api/afisha_poster", requireAuth, async (req, res) => {
  try { const u = url(req.query.url); if (!u || !/^https:\/\/(store\.rambler\.ru|[a-z0-9.-]*afisha\.ru)\//.test(u)) return res.status(400).json({ error: "Недопустимый адрес картинки" });
    const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); const ct = r.headers.get("content-type") || ""; const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[ct.split(";")[0]];
    if (!r.ok || !ext) return res.status(400).json({ error: "Постер не картинка" });
    const name = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`; fs.writeFileSync(path.join(PHOTOS_DIR, name), Buffer.from(await r.arrayBuffer())); res.json({ ok: true, photo: "photos/" + name }); }
  catch (e) { res.status(502).json({ error: "Не удалось скачать постер: " + e.message }); }
});
app.get("/api/afisha_import", requireAuth, async (req, res) => {
  try {
    const q = str(req.query.q, 300); const data = readData(); const partner = str(data.theatre?.afishaPartnerId, 20).replace(/\D/g, "") || "37";
    let showId = "";
    if (/^https?:\/\//.test(q)) {
      const html = await httpGet(q); let m = html.match(/shows_id\s*:\s*(\d+)/);
      if (m) showId = m[1]; else if ((m = html.match(/openModal\((\d+)\)/))) { const j = JSON.parse(await httpGet(`https://tickets.afisha.ru/wl/${partner}/api/events/info?lang=ru&event_id=${m[1]}`)); showId = String(j.event?.show_id || ""); }
      if (!showId) return res.status(400).json({ error: "На этой странице не нашлось виджета Афиши" });
    } else { showId = q.replace(/\D/g, ""); if (!showId) return res.status(400).json({ error: "Укажите ID спектакля в Афише или ссылку на teatrdoc.ru" }); }
    const show = await afishaShow(partner, showId); if (!show) return res.status(400).json({ error: "Афиша не вернула спектакль с ID " + showId });
    res.json({ ok: true, showId: String(show.id), name: String(show.name || ""), image: String(show.image || ""), age: Number(show.age_limit || 0), events: afishaEvents(show) });
  } catch (e) { res.status(400).json({ error: "Ошибка запроса к Афише: " + e.message }); }
});

/* ---------- пуш-уведомления (Web Push, VAPID) и лист ожидания — как в api.php ---------- */
const PUSH_FILE = path.join(DATA_DIR, "push.json"), PUSH_KEYS = path.join(DATA_DIR, "push-keys.json"), WAIT_FILE = path.join(DATA_DIR, "waitlist.json");
const b64u = b => Buffer.from(b).toString("base64url");
const readAny = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
function pushKeys() {
  const k = readAny(PUSH_KEYS, null); if (k && k.private) return k;
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const nk = { private: privateKey.export({ type: "pkcs8", format: "pem" }), public: b64u(pub), cron: crypto.randomBytes(12).toString("hex"), created: new Date().toISOString() };
  writeJson(PUSH_KEYS, nk); return nk;
}
function vapidJwt(aud, k, contact) {
  const data = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." + b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact }));
  return data + "." + b64u(crypto.sign("sha256", Buffer.from(data), { key: k.private, dsaEncoding: "ieee-p1363" }));
}
async function pushPoke(endpoint, k, contact) {
  const u = new URL(endpoint);
  try { const r = await fetch(endpoint, { method: "POST", headers: { Authorization: "vapid t=" + vapidJwt(u.origin, k, contact) + ", k=" + k.public, TTL: "86400", "Content-Length": "0", Urgency: "normal" } }); return r.status; }
  catch { return 0; }
}
const pushDb = () => Object.assign({ subs: {} }, readAny(PUSH_FILE, {}));
const evKey = e => (e.date || "") + "_" + (e.time || "") + "_" + (e.playId || "");
const siteBase = req => (req.headers["x-forwarded-proto"] || req.protocol) + "://" + req.get("host") + "/";
async function pushRun(base) {
  const data = readData(), db = pushDb(), k = pushKeys(), contact = "mailto:" + (data.theatre?.email || "admin@example.com");
  const plays = Object.fromEntries((data.plays || []).map(p => [p.id, p]));
  const events = Object.fromEntries((data.events || []).filter(e => !e.hidden).map(e => [evKey(e), e]));
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];
  const when = e => { const [, m, d] = e.date.split("-").map(Number); return d + " " + MONTHS[m - 1] + (e.time ? " в " + e.time : ""); };
  const title = e => plays[e.playId]?.title || e.note || "Спектакль";
  const urlOf = e => plays[e.playId] ? "play.html?id=" + encodeURIComponent(e.playId) : "./";
  const hoursTo = e => (new Date(e.date + "T" + (e.time || "19:00") + ":00+03:00") - Date.now()) / 36e5;
  const todayMsk = new Date(Date.now() + 3 * 36e5).toISOString().slice(0, 10);
  const mails = readAny(WAIT_FILE, []);
  const waiting = Object.values(db.subs).some(s => Object.keys(s.wait || {}).length) || mails.some(m => !m.sent);
  const sessions = {};
  if (waiting) { const partner = str(data.theatre?.afishaPartnerId, 20).replace(/\D/g, "");
    if (partner) for (const sid of new Set((data.plays || []).map(p => str(p.afishaShowId, 40).replace(/\D/g, "")).filter(Boolean))) { try { const show = await afishaShow(partner, sid); if (show) for (const e of afishaEvents(show)) sessions[e.sessionId] = e.count; } catch {} } }
  const available = e => { const sid = String(e.afishaSessionId || "").replace(/\D/g, ""); return sid && sessions[sid] > 0; };
  const stat = { sent: 0, failed: 0, removed: 0, mailed: 0 };
  for (const [id, s] of Object.entries(db.subs)) {
    const queue = [];
    for (const [key, done] of Object.entries(s.remind || {})) {
      const e = events[key]; if (!e) { delete s.remind[key]; continue; }
      const h = hoursTo(e); if (h < -3) { delete s.remind[key]; continue; }
      if (!done && h <= 26) { queue.push({ title: (e.date === todayMsk ? "Сегодня" : "Завтра") + ": «" + title(e) + "»", body: when(e) + ", " + (e.venue || data.theatre?.venue || "") + ". Ждём вас!", url: urlOf(e), tag: "remind-" + key }); s.remind[key] = 1; }
    }
    for (const [key, done] of Object.entries(s.wait || {})) {
      const e = events[key]; if (!e || hoursTo(e) < 0) { delete s.wait[key]; continue; }
      if (!done && available(e)) { queue.push({ title: "Появились билеты: «" + title(e) + "»", body: when(e) + ". Успейте, пока снова не разобрали.", url: urlOf(e), tag: "wait-" + key }); delete s.wait[key]; }
    }
    if (!queue.length) continue;
    s.pending = (s.pending || []).concat(queue);
    const code = await pushPoke(s.endpoint, k, contact);
    if (code === 404 || code === 410) { delete db.subs[id]; stat.removed++; continue; }
    if (code >= 200 && code < 300) { stat.sent++; s.fails = 0; } else { stat.failed++; s.fails = (s.fails || 0) + 1; if (s.fails >= 5) { delete db.subs[id]; stat.removed++; } }
  }
  let changed = false;
  for (const m of mails) {
    if (m.sent) continue;
    const e = events[m.key]; if (!e || hoursTo(e) < 0) { m.sent = "expired"; changed = true; continue; }
    if (available(e)) { console.log("[waitlist] письмо для " + m.email + ": появились билеты на «" + title(e) + "» " + when(e) + " " + base + urlOf(e) + " (SMTP не настроен — только лог)"); m.sent = "logged"; changed = true; stat.mailed++; }
  }
  if (changed) writeJson(WAIT_FILE, mails);
  db.lastRun = new Date().toISOString(); db.lastStat = stat; writeJson(PUSH_FILE, db);
  return stat;
}
app.get("/api/push_key", (req, res) => res.json({ ok: true, key: pushKeys().public }));
app.post("/api/push_sub", (req, res) => {
  const b = req.body || {}, sub = b.sub || {}, endpoint = str(sub.endpoint, 2000), kind = str(b.kind, 10), key = str(b.key, 80);
  if (!/^https:\/\/\S+$/.test(endpoint)) return res.status(400).json({ error: "bad endpoint" });
  if (!/^[\d\-:_\w]*$/u.test(key)) return res.status(400).json({ error: "bad key" });
  const db = pushDb(); if (Object.keys(db.subs).length >= 5000) return res.status(429).json({ error: "Слишком много подписок" });
  const id = crypto.createHash("sha1").update(endpoint).digest("hex");
  if (kind === "renew" && b.old) { const oldId = crypto.createHash("sha1").update(str(b.old, 2000)).digest("hex"); if (db.subs[oldId]) { db.subs[id] = db.subs[oldId]; delete db.subs[oldId]; } }
  const s = db.subs[id] || { created: new Date().toISOString(), remind: {}, wait: {}, pending: [] };
  s.endpoint = endpoint; s.keys = { p256dh: str(sub.keys?.p256dh, 200), auth: str(sub.keys?.auth, 100) };
  if (kind === "remind" && key) s.remind[key] = 0;
  if (kind === "wait" && key) s.wait[key] = 0;
  if (kind === "off" && key) { delete s.remind[key]; delete s.wait[key]; }
  db.subs[id] = s; writeJson(PUSH_FILE, db);
  res.json({ ok: true, remind: Object.keys(s.remind), wait: Object.keys(s.wait) });
});
app.post("/api/push_msg", (req, res) => {
  const db = pushDb(), id = crypto.createHash("sha1").update(str(req.body?.endpoint, 2000)).digest("hex");
  const msgs = db.subs[id]?.pending || []; if (msgs.length) { db.subs[id].pending = []; writeJson(PUSH_FILE, db); }
  res.json({ ok: true, messages: msgs });
});
app.all("/api/push_send", async (req, res) => {
  const k = pushKeys();
  if (!isAuthed(req) && !safeEqual(String(req.query.key || ""), k.cron)) return res.status(401).json({ error: "unauthorized" });
  res.json({ ok: true, ...(await pushRun(siteBase(req))) });
});
app.get("/api/push_stats", requireAuth, (req, res) => {
  const db = pushDb(), k = pushKeys(); let remind = 0, wait = 0;
  for (const s of Object.values(db.subs)) { remind += Object.values(s.remind || {}).filter(v => !v).length; wait += Object.keys(s.wait || {}).length; }
  res.json({ ok: true, subs: Object.keys(db.subs).length, remind, wait, mails: readAny(WAIT_FILE, []).filter(m => !m.sent).length, lastRun: db.lastRun || null, lastStat: db.lastStat || null, cronUrl: siteBase(req) + "api/push_send?key=" + k.cron });
});
app.post("/api/waitlist", (req, res) => {
  const email = str(req.body?.email, 120), key = str(req.body?.key, 80);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Проверьте адрес почты" });
  if (!key || !/^[\d\-:_\w]*$/u.test(key)) return res.status(400).json({ error: "bad key" });
  const mails = readAny(WAIT_FILE, []); if (mails.length >= 5000) return res.status(429).json({ error: "Лист ожидания переполнен" });
  if (!mails.some(m => m.email === email && m.key === key && !m.sent)) { mails.push({ email, key, created: new Date().toISOString(), sent: null }); writeJson(WAIT_FILE, mails); }
  res.json({ ok: true });
});

app.get("/sitemap.xml", (req, res) => {
  const d = readData(); const base = `${req.protocol}://${req.get("host")}`;
  const urls = ["/", "/golos", ...(d.plays || []).map(p => "/play.html?id=" + encodeURIComponent(p.id))];
  res.type("application/xml").send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + urls.map(u => `<url><loc>${base}${u.replace(/&/g, "&amp;")}</loc></url>`).join("") + "</urlset>");
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Файл больше 8 МБ" : "Ошибка запроса" });
});

app.listen(PORT, () => {
  console.log(`Сайт:    http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
});
