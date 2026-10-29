const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "10kb" }));
app.set("trust proxy", 1);

// To add a school: add its id here AND to the SCH list in public/index.html
const SCHOOLS = new Set(["all","ust","feu","nu","ceu","adu","sbu","ue","mapua","letran","arellano","lyceum","tup","pup"]);
const REASONS = new Set(["naming","bullying","hate","sexual","threat","spam","nowarn","danger","other"]);
const WARNINGS = new Set(["adult","selfharm","abuse","grief","ed","substance","other"]);

// ---- tiny JSON-file "database" (swap for Supabase later) ----
const DB_FILE = path.join(__dirname, "data", "campus.json");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
let db = [];
try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
if (!db.length) {
  const now = Date.now();
  db = [
    { id: 1, school: "ust", text: "Pagod na ako pero ayokong sabihin sa mga kaibigan ko. Mukha silang okay lahat.", warnings: [], at: new Date(now - 2*3600e3).toISOString(), hugs: 14, reports: 0 },
    { id: 2, school: "feu", text: "Salamat sa stranger na nagpahiram ng payong kanina. Hindi mo alam na nakatulong ka sa buong araw ko.", warnings: [], at: new Date(now - 5*3600e3).toISOString(), hugs: 22, reports: 0 },
    { id: 3, school: "pup", text: "Para sa lahat ng nagtatrabaho habang nag-aaral: nakikita namin kayo.", warnings: [], at: new Date(now - 7*3600e3).toISOString(), hugs: 40, reports: 0 },
    { id: 4, school: "all", text: "Okay lang ding hindi maging okay ngayong finals week.", warnings: [], at: new Date(now - 3*3600e3).toISOString(), hugs: 88, reports: 0 }
  ];
}
let nextId = db.reduce((m, x) => Math.max(m, x.id), 0) + 1;
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));

// ---- safety rules ----
const BLOCKED = /(\b(\+?63|0)9\d{9}\b|\b\d{3}[\s-]?\d{3}[\s-]?\d{4}\b|https?:\/\/|www\.|@\w{3,})/i;
const BAD_WORDS = ["putangina","gago ka","bobo ka"]; // placeholder: expand this list
const CRISIS = /(magpakamatay|mamatay na|ayoko nang mabuhay|gusto ko nang mawala|kill myself|suicid|end it all|want to die|saktan ang sarili)/i;
const HIDE_AFTER_REPORTS = 2; // small campuses: hide faster

// ---- simple in-memory rate limits (IPs are NOT stored on disk) ----
const lastPost = new Map();
const actions = new Set();
setInterval(() => { lastPost.clear(); actions.clear(); }, 6 * 3600e3).unref();

// Messages with a content warning are sent WITHOUT their text; the reader must choose to open them.
const publicMsg = m => ({ id: m.id, school: m.school, text: (m.warnings || []).length ? null : m.text, len: (m.warnings || []).length ? m.text.length : undefined, warnings: m.warnings || [], at: m.at, hugs: m.hugs });
const visible = m => m.reports < HIDE_AFTER_REPORTS;

app.get("/api/messages", (req, res) => {
  const school = SCHOOLS.has(req.query.school) ? req.query.school : "all";
  const list = db.filter(m => visible(m) && m.school === school)
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 100).map(publicMsg);
  res.json(list);
});

app.get("/api/messages/:id", (req, res) => {
  const m = db.find(x => x.id === Number(req.params.id));
  if (!m || !visible(m)) return res.status(404).json({ error: "Not found" });
  res.json({ id: m.id, text: m.text });
});

app.get("/api/counts", (req, res) => {
  const c = {};
  db.filter(visible).forEach(m => { c[m.school] = (c[m.school] || 0) + 1; });
  res.json(c);
});

app.post("/api/messages", (req, res) => {
  const text = String(req.body.text || "").trim();
  const school = req.body.school;
  if (text.length < 3) return res.status(400).json({ error: "Write a little more first." });
  if (text.length > 500) return res.status(400).json({ error: "Max 500 characters." });
  if (!SCHOOLS.has(school)) return res.status(400).json({ error: "Pick a school." });
  if (BLOCKED.test(text)) return res.status(400).json({ error: "Please remove phone numbers, links, or handles to keep everyone safe." });
  if (BAD_WORDS.some(w => text.toLowerCase().includes(w))) return res.status(400).json({ error: "Please keep it kind. Rephrase and try again." });
  const last = lastPost.get(req.ip) || 0;
  if (Date.now() - last < 15000) return res.status(429).json({ error: "Easy, wait a few seconds before sending another." });
  lastPost.set(req.ip, Date.now());

  let warnings = Array.isArray(req.body.warnings) ? [...new Set(req.body.warnings.filter(w => WARNINGS.has(w)))] : [];
  const crisis = CRISIS.test(text);
  if (crisis && !warnings.includes("selfharm")) warnings.push("selfharm"); // auto-protect readers

  const msg = { id: nextId++, school, text, warnings, at: new Date().toISOString(), hugs: 0, reports: 0 };
  db.push(msg); save();
  res.status(201).json({ ok: true, crisis, message: publicMsg(msg) });
});

function once(req, res, kind, fn) {
  const m = db.find(x => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Not found" });
  const key = `${kind}:${req.ip}:${m.id}`;
  if (!actions.has(key)) { actions.add(key); fn(m); save(); }
  res.json({ ok: true, hugs: m.hugs });
}
app.post("/api/messages/:id/hug", (req, res) => once(req, res, "hug", m => m.hugs++));
app.post("/api/messages/:id/report", (req, res) => {
  const m = db.find(x => x.id === Number(req.params.id));
  if (!m) return res.status(404).json({ error: "Not found" });
  const reason = REASONS.has(req.body.reason) ? req.body.reason : "other";
  const note = String(req.body.note || "").trim().slice(0, 200);
  const key = `report:${req.ip}:${m.id}`;
  if (!actions.has(key)) {
    actions.add(key);
    m.reasons = m.reasons || [];
    m.reasons.push(reason);
    if (reason === "other" && note) { m.notes = m.notes || []; m.notes.push(note); }
    if (reason === "nowarn") {
      // enough people say it needs a warning -> blur it for everyone
      if (m.reasons.filter(r => r === "nowarn").length >= 2 && !(m.warnings || []).includes("other")) {
        m.warnings = [...(m.warnings || []), "other"];
      }
    } else if (reason === "danger") {
      console.log(`[ATTENTION] message #${m.id} was reported as someone possibly in danger`); // not hidden: the writer may need help
    } else {
      m.reports++;
    }
    save();
  }
  res.json({ ok: true });
});

app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bulong running at http://localhost:${PORT}`));