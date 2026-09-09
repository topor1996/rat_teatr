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
const PHOTOS_DIR = path.join(ROOT, "photos");
const PORT = process.env.PORT || 3000;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PHOTOS_DIR, { recursive: true });

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
function sanitize(input) {
  const show = input.show || {}, th = input.theatre || {};
  const arr = v => (Array.isArray(v) ? v : []);
  const actors = arr(input.actors).slice(0, 50).map(a => ({
    name: str(a.name, 100), role: str(a.role, 100), scene: str(a.scene, 400), bio: str(a.bio, 600),
    photo: img(a.photo), sbp: url(a.sbp), phone: str(a.phone, 30), bank: str(a.bank, 60),
  })).filter(a => a.name);
  const plays = arr(input.plays).slice(0, 50).map((p, i) => ({
    id: str(p.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, "") || "play-" + (i + 1),
    title: str(p.title, 100), genre: str(p.genre, 120), description: str(p.description, 1500),
    poster: img(p.poster), duration: str(p.duration, 40), age: str(p.age, 6), ticketUrl: url(p.ticketUrl),
  })).filter(p => p.title);
  const events = arr(input.events).slice(0, 200).map(e => ({
    date: str(e.date, 10), time: str(e.time, 5), playId: str(e.playId, 40), venue: str(e.venue, 120),
    price: str(e.price, 40), ticketUrl: url(e.ticketUrl), note: str(e.note, 120),
  })).filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.date)).sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  return {
    theatre: { name: str(th.name, 100), tagline: str(th.tagline, 200), about: str(th.about, 2000), venue: str(th.venue, 120), address: str(th.address, 200),
               instagram: url(th.instagram), telegram: url(th.telegram), vk: url(th.vk), email: str(th.email, 100), phone: str(th.phone, 30), ticketsUrl: url(th.ticketsUrl) },
    plays, events,
    show: { theatre: str(show.theatre, 100), title: str(show.title, 100), dates: str(show.dates, 100) },
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
      const ext = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[file.mimetype] || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(3).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
});

// ---------- приложение ----------
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "admin.html")));
app.get("/golos", (req, res) => res.sendFile(path.join(ROOT, "golos.html")));
app.use("/photos", express.static(PHOTOS_DIR, { maxAge: "1d" }));

app.get("/api/data", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(readData());
});

app.post("/api/login", (req, res) => {
  const ip = req.ip;
  const att = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (att.until > Date.now()) return res.status(429).json({ error: "Слишком много попыток, подождите минуту" });
  if (safeEqual(req.body?.password || "", PASSWORD)) {
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
app.post("/api/logout", (req, res) => {
  sessions.delete(parseCookies(req).rat_admin);
  res.set("Set-Cookie", "rat_admin=; Path=/; HttpOnly; Max-Age=0");
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => res.json({ authed: isAuthed(req) }));

app.put("/api/data", requireAuth, (req, res) => {
  const data = sanitize(req.body || {});
  writeData(data);
  res.json({ ok: true, data });
});

app.post("/api/upload", requireAuth, upload.single("photo"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Нужен файл JPG, PNG или WebP до 8 МБ" });
  res.json({ ok: true, photo: `photos/${req.file.filename}` });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Файл больше 8 МБ" : "Ошибка запроса" });
});

app.listen(PORT, () => {
  console.log(`Сайт:    http://localhost:${PORT}`);
  console.log(`Админка: http://localhost:${PORT}/admin`);
});
