import { AwsClient } from "aws4fetch";

const STATUSES = ["To Do", "In Progress", "Blocked", "Done"];
const PRIORITIES = ["High", "Medium", "Low"];
const MAX_IMG = 5 * 1024 * 1024;

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
const text = (t, type = "text/plain; charset=utf-8", extra = {}) =>
  new Response(t, { headers: { "content-type": type, ...extra } });
class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const nowIso = () => new Date().toISOString();
const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const localDate = (iso, tz) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: tz });

function checkAuth(req, env) {
  if (!env.APP_PASSWORD) return null;
  const h = req.headers.get("authorization") || "";
  if (h.startsWith("Basic ")) {
    const pass = atob(h.slice(6)).split(":").slice(1).join(":");
    if (pass === env.APP_PASSWORD) return null;
  }
  return new Response("Login diperlukan", {
    status: 401, headers: { "www-authenticate": 'Basic realm="Issue Tracker"' },
  });
}


// ---- Penyimpanan screenshot: R2 lewat S3 API (beda akun) atau binding R2 (akun sama) ----
function s3(env) {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID) return null;
  return {
    client: new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" }),
    base: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET || "tracker"}`,
  };
}
const storageOn = (env) => !!(s3(env) || env.BUCKET);

async function putObj(env, key, buf, type) {
  const c = s3(env);
  if (c) {
    const r = await c.client.fetch(`${c.base}/${key}`, { method: "PUT", body: buf, headers: { "content-type": type } });
    if (!r.ok) throw new Error(`R2 PUT ${r.status}`);
  } else {
    await env.BUCKET.put(key, buf, { httpMetadata: { contentType: type } });
  }
}

async function getObj(env, key) {
  const c = s3(env);
  if (c) {
    const r = await c.client.fetch(`${c.base}/${key}`);
    if (!r.ok) return null;
    return new Response(r.body, { headers: { "content-type": r.headers.get("content-type") || "image/jpeg", "cache-control": "private, max-age=86400" } });
  }
  const o = await env.BUCKET.get(key);
  return o ? new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "image/jpeg" } }) : null;
}

async function log(env, id, kind, detail = "") {
  await env.DB.prepare("INSERT INTO events(issue_id,kind,detail,at) VALUES(?,?,?,?)")
    .bind(id, kind, detail, nowIso()).run();
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const PROMPT = (today) => `Kamu membaca screenshot chat WhatsApp berisi penugasan kerja.
Pisahkan menjadi issue/task terpisah. Satu issue = satu pekerjaan yang diminta.
Abaikan obrolan yang bukan tugas. Gabungkan pesan yang membahas hal yang sama.
Hari ini: ${today}.
Balas HANYA dengan JSON array. Tiap elemen:
{"title":"judul singkat max 80 karakter","summary":"ringkasan 1-2 kalimat","requester":"nama pengirim atau kosong","priority":"High|Medium|Low","deadline":"tanggal/jam jika disebut, jika tidak kosong"}
Gunakan bahasa yang sama dengan chat. Jika tidak ada task, balas [].`;

async function askAI(env, images) {
  if (!env.AI_API_KEY) throw new HttpError(500, "AI_API_KEY belum di-set (wrangler secret put AI_API_KEY)");
  const content = images.map((i) => ({
    type: "image_url", image_url: { url: `data:${i.type};base64,${toBase64(i.buf)}` },
  }));
  content.push({ type: "text", text: PROMPT(localDate(nowIso(), env.TZ || "Asia/Jakarta")) });
  const base = (env.AI_BASE_URL || "https://api.nusagate.com/v1").replace(/\/$/, "");
  const r = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.AI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: env.MODEL || "glm-5.3-flash", max_tokens: 4000, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new HttpError(502, `AI API error ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || "";
}

function parseArray(t) {
  const m = t.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try { const d = JSON.parse(m[0]); return Array.isArray(d) ? d : []; } catch { return []; }
}

async function extract(req, env) {
  const form = await req.formData();
  const images = [], keys = [];
  for (const f of form.getAll("files")) {
    if (typeof f === "string" || !/^image\/(jpeg|png|gif|webp)$/.test(f.type)) continue;
    const buf = await f.arrayBuffer();
    if (buf.byteLength > MAX_IMG) throw new HttpError(413, "Gambar lebih dari 5MB");
    images.push({ type: f.type, buf });
    if (storageOn(env)) {
      const key = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}.jpg`;
      try { await putObj(env, key, buf, f.type); keys.push(key); } catch (e) { console.log("simpan screenshot gagal:", e.message); }
    }
  }
  if (!images.length) throw new HttpError(400, "Tidak ada gambar");
  const found = parseArray(await askAI(env, images));
  const { results } = await env.DB.prepare("SELECT title FROM issues WHERE status!='Done'").all();
  const existing = new Set(results.map((r) => norm(r.title)));
  let added = 0;
  for (const a of found) {
    const title = String(a.title || "").trim();
    if (!title || existing.has(norm(title))) continue;
    const pr = PRIORITIES.includes(a.priority) ? a.priority : "Medium";
    const t = nowIso();
    const r = await env.DB.prepare(
      "INSERT INTO issues(title,summary,requester,priority,deadline,screenshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)"
    ).bind(title.slice(0, 200), a.summary || "", a.requester || "", pr, a.deadline || "", keys.join(","), t, t).run();
    await log(env, r.meta.last_row_id, "created", "dari screenshot");
    existing.add(norm(title)); added++;
  }
  return json({ added, found: found.length });
}

async function listIssues(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM issues ORDER BY CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, id DESC"
  ).all();
  return json(results);
}

async function createIssue(req, env) {
  const b = await req.json();
  if (!b.title) throw new HttpError(400, "Judul wajib");
  const t = nowIso();
  const r = await env.DB.prepare(
    "INSERT INTO issues(title,summary,requester,priority,deadline,created_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).bind(b.title, b.summary || "", b.requester || "", PRIORITIES.includes(b.priority) ? b.priority : "Medium", b.deadline || "", t, t).run();
  await log(env, r.meta.last_row_id, "created", "manual");
  return json({ id: r.meta.last_row_id });
}

async function patchIssue(req, env, id) {
  const b = await req.json();
  if (b.status !== undefined && !STATUSES.includes(b.status)) throw new HttpError(400, "Status tidak valid");
  if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) throw new HttpError(400, "Prioritas tidak valid");
  const old = await env.DB.prepare("SELECT * FROM issues WHERE id=?").bind(id).first();
  if (!old) throw new HttpError(404, "Tidak ditemukan");
  const data = {};
  for (const k of ["title", "summary", "requester", "priority", "deadline", "status", "note"])
    if (b[k] !== undefined && b[k] !== null) data[k] = b[k];
  if (!Object.keys(data).length) return json({ ok: true });
  if (data.status && data.status !== old.status) {
    await log(env, id, "status", `${old.status} -> ${data.status}`);
    data.done_at = data.status === "Done" ? nowIso() : null;
  }
  if (data.note !== undefined && data.note !== old.note) await log(env, id, "note", data.note);
  data.updated_at = nowIso();
  const cols = Object.keys(data).map((k) => `${k}=?`).join(", ");
  await env.DB.prepare(`UPDATE issues SET ${cols} WHERE id=?`).bind(...Object.values(data), id).run();
  return json({ ok: true });
}

async function report(env) {
  const tz = env.TZ || "Asia/Jakarta";
  const today = localDate(nowIso(), tz);
  const { results } = await env.DB.prepare("SELECT * FROM issues").all();
  const d = new Date().toLocaleDateString("id-ID", { timeZone: tz, day: "numeric", month: "long", year: "numeric" });
  const out = [`*Laporan Akhir Shift - ${d}*`, ""];
  for (const [label, st] of [["Selesai hari ini", "Done"], ["Sedang dikerjakan", "In Progress"], ["Terkendala", "Blocked"], ["Belum dimulai", "To Do"]]) {
    const items = results.filter((r) => r.status === st && (st !== "Done" || (r.done_at && localDate(r.done_at, tz) === today)));
    if (!items.length) continue;
    out.push(`*${label}*`, ...items.map((r) => `- ${r.title}${r.note ? ` (${r.note})` : ""}`), "");
  }
  return text(out.join("\n"));
}

async function exportCsv(env) {
  const cols = ["id", "title", "summary", "requester", "priority", "deadline", "status", "note", "created_at", "done_at"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const { results } = await env.DB.prepare("SELECT * FROM issues ORDER BY id").all();
  const csv = [cols.join(","), ...results.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n");
  return text(csv, "text/csv; charset=utf-8", { "content-disposition": "attachment; filename=issues.csv" });
}

async function route(req, env, url) {
  const p = url.pathname, m = req.method;
  let x;
  if (p === "/api/extract" && m === "POST") return extract(req, env);
  if (p === "/api/issues" && m === "GET") return listIssues(env);
  if (p === "/api/issues" && m === "POST") return createIssue(req, env);
  if ((x = p.match(/^\/api\/issues\/(\d+)$/))) {
    if (m === "PATCH") return patchIssue(req, env, +x[1]);
    if (m === "DELETE") {
      await env.DB.prepare("DELETE FROM events WHERE issue_id=?").bind(+x[1]).run();
      await env.DB.prepare("DELETE FROM issues WHERE id=?").bind(+x[1]).run();
      return json({ ok: true });
    }
  }
  if ((x = p.match(/^\/api\/issues\/(\d+)\/events$/)) && m === "GET") {
    const { results } = await env.DB.prepare("SELECT kind,detail,at FROM events WHERE issue_id=? ORDER BY id").bind(+x[1]).all();
    return json(results);
  }
  if (p === "/api/report") return report(env);
  if (p === "/api/export.csv") return exportCsv(env);
  if ((x = p.match(/^\/uploads\/([\w.-]+)$/)) && storageOn(env)) {
    const o = await getObj(env, x[1]);
    if (!o) throw new HttpError(404, "Tidak ada");
    return o;
  }
  throw new HttpError(404, "Tidak ditemukan");
}

export default {
  async fetch(req, env) {
    const denied = checkAuth(req, env);
    if (denied) return denied;
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/") && !url.pathname.startsWith("/uploads/")) return env.ASSETS.fetch(req);
    try { return await route(req, env, url); }
    catch (e) { return json({ detail: e.message }, e.status || 500); }
  },
};
