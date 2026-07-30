// ==================================================================
//  고객관리 센터 — 클라우드 서버 (Deno Deploy)
//
//  관리자 PC 를 켜 두지 않아도 직원이 아무 때나 접속할 수 있도록,
//  serve.ps1 이 하던 일을 그대로 클라우드로 옮긴 것이다.
//  화면(index.html · app.js)은 손대지 않고 그대로 쓰며, 서버가 주고받는
//  주소와 응답 모양도 serve.ps1 과 똑같이 맞췄다.
//
//  자료를 어디에 두는가
//    serve.ps1 : data.json(스냅샷) + ops.jsonl(변경기록) + state.json
//    여기       : Deno KV (키-값 저장소) 한 곳
//
//    ["state"]                     → 현재 시점(rev)·id 발급번호
//    ["row", 컬렉션, id]            → 문의 한 줄
//    ["doc", "meta"|"companies", 조각번호] → 설정·업체 목록 (64KB 씩 나눠 담음)
//    ["ops", rev]                  → 변경 한 묶음 (3초마다 직원들이 받아감)
//    ["blob", 파일명, 조각번호]      → 첨부파일 (KV 한 칸이 64KB 라 나눠 담는다)
//
//  왜 줄 하나를 통째로 안 쓰고 칸 단위로 쌓는가:
//  두 직원이 각자 다른 줄을 고쳤을 때 나중에 저장한 사람이 앞사람 것을
//  지우지 않게 하기 위해서다. 이 원칙은 serve.ps1 과 동일하다.
// ==================================================================

const kv = await Deno.openKv();

const ADMIN_PASSWORD = (Deno.env.get("ADMIN_PASSWORD") || "").trim();
const LINK_KEY = (Deno.env.get("LINK_KEY") || "").trim();

// 컬렉션 이름 ↔ id 발급번호 이름
const COLLS = ["customers", "genCustomers", "notices"] as const;
type Coll = (typeof COLLS)[number];
const NEXT_KEY: Record<Coll, "nextId" | "nextGenId" | "nextNoticeId"> = {
  customers: "nextId",
  genCustomers: "nextGenId",
  notices: "nextNoticeId",
};

type State = {
  rev: number;      // 지금 시점
  floor: number;    // 이 값보다 오래된 시점의 변경기록은 이미 지웠다 → 전체 다시 받아야 함
  nextId: number;
  nextGenId: number;
  nextNoticeId: number;
  ordLo: number;    // 맨 위에 새 줄을 넣을 때 쓰는 순번 (점점 작아진다)
  ordHi: number;    // 맨 아래에 붙일 때 쓰는 순번 (점점 커진다)
};

const DEFAULT_STATE: State = {
  rev: 0, floor: 0,
  nextId: 1, nextGenId: 1, nextNoticeId: 1,
  ordLo: 0, ordHi: 1,
};

const DEFAULT_META = {
  title: "고객관리 센터",
  programs: ["수출바우처", "혁신바우처", "소공인판로개척지원사업", "기타정부사업"],
  categories: ["기고객", "신규고객"],
  staff: [] as string[],
};

// 변경기록을 몇 개까지 들고 있을지. 이보다 오래된 건 지우고, 그때는 전체를 다시 받게 한다.
const OPS_KEEP = 3000;
const CHUNK = 60000;          // 첨부파일 조각 크기 (KV 한 칸 64KB 제한)
const MAX_MUTATIONS = 500;    // KV 한 번의 원자적 처리에 넣을 수 있는 개수 여유값
const MAX_BATCH_BYTES = 400000; // 한 번에 보낼 수 있는 총 크기 여유값 (KV 한도는 약 800KB)

const enc = new TextEncoder();

// 개수와 크기를 모두 지켜 가며 나눠 저장한다.
//
// 크기는 반드시 "바이트"로 재야 한다. 한글은 UTF-8 에서 한 글자가 3바이트라,
// 글자 수로 재면 실제 크기의 1/3 로 잘못 보고 한도를 넘겨 버린다.
async function putBatched(puts: { key: Deno.KvKey; value: unknown }[]) {
  let at = kv.atomic();
  let n = 0, bytes = 0;
  for (const p of puts) {
    const size = enc.encode(JSON.stringify(p.value)).length + 100;
    if (n > 0 && (n >= MAX_MUTATIONS || bytes + size > MAX_BATCH_BYTES)) {
      await at.commit();
      at = kv.atomic();
      n = 0; bytes = 0;
    }
    at = at.set(p.key, p.value);
    n++; bytes += size;
  }
  if (n > 0) await at.commit();
}

async function delBatched(keys: Deno.KvKey[]) {
  for (let i = 0; i < keys.length; i += MAX_MUTATIONS) {
    let at = kv.atomic();
    for (const k of keys.slice(i, i + MAX_MUTATIONS)) at = at.delete(k);
    await at.commit();
  }
}

// ---------- 공통 응답 ----------
const JSON_TYPE = "application/json; charset=utf-8";

function jsonRes(obj: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": JSON_TYPE, ...(headers || {}) },
  });
}
function textRes(text: string, status = 200, type = "text/plain; charset=utf-8") {
  return new Response(text, { status, headers: { "content-type": type } });
}

// ------------------------------------------------------------------
//  설정(meta)·업체목록(companies) 담기
//
//  KV 한 칸에는 64KB 까지만 들어간다. 업체목록은 그보다 커질 수 있으므로
//  (지금도 107KB) 글자를 UTF-8 바이트로 바꿔 조각내어 나눠 담는다.
//  바이트로 잘라야 한글이 중간에서 반 토막 나지 않는다.
// ------------------------------------------------------------------
const dec = new TextDecoder();

async function setDoc(name: string, value: unknown) {
  // 지우고 넘어갈 옛 조각이 몇 개인지 먼저 알아 둔다 (덮어쓴 뒤에는 알 수 없다)
  const old = (await kv.get<{ parts: number }>(["docinfo", name])).value;

  const bytes = enc.encode(JSON.stringify(value));
  const parts = Math.ceil(bytes.length / CHUNK) || 1;
  // 조각을 먼저 넣고 마지막에 개수를 적는다 → 읽는 쪽이 반쪽짜리를 보지 않는다
  for (let i = 0; i < parts; i++) {
    await kv.set(["doc", name, i], bytes.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  await kv.set(["docinfo", name], { parts });

  // 내용이 줄어 조각 수가 적어졌다면 남은 옛 조각을 치운다
  if (old && old.parts > parts) {
    for (let i = parts; i < old.parts; i++) await kv.delete(["doc", name, i]);
  }
}

async function getDoc<T>(name: string, fallback: T): Promise<T> {
  const info = (await kv.get<{ parts: number }>(["docinfo", name])).value;
  if (!info) return fallback;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (let i = 0; i < info.parts; i++) {
    const c = (await kv.get<Uint8Array>(["doc", name, i])).value;
    if (!c) return fallback;
    chunks.push(c);
    total += c.length;
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.length; }
  try { return JSON.parse(dec.decode(buf)) as T; } catch { return fallback; }
}

// ---------- 상태 읽기 ----------
async function getState(): Promise<{ value: State; versionstamp: string | null }> {
  const r = await kv.get<State>(["state"]);
  return { value: { ...DEFAULT_STATE, ...(r.value || {}) }, versionstamp: r.versionstamp };
}

// ==================================================================
//  변경 묶음 기록하기
//
//  같은 순간에 두 직원이 보내도 시점(rev)이 겹치지 않아야 한다. KV 의
//  "이 값이 그대로면 저장"(check) 기능으로 상태를 잡고, 놓치면 다시 시도한다.
// ==================================================================
type Op =
  | { t: "set" | "cset"; coll: Coll; id: number; f: Record<string, unknown> }
  | { t: "add"; coll: Coll; rows?: Row[]; row?: Row; top?: boolean }
  | { t: "del"; coll: Coll; ids: number[] }
  | { t: "meta"; f: Record<string, unknown> };

type Row = Record<string, unknown> & { id?: number; _ord?: number };

function isColl(v: unknown): v is Coll {
  return typeof v === "string" && (COLLS as readonly string[]).includes(v);
}

async function commitOps(ops: Op[], user: string, cid: string) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value: st, versionstamp } = await getState();

    // set/cset 은 기존 줄에 얹는 것이라, 먼저 읽어 와야 한다
    const needed = new Map<string, Deno.KvKey>();
    for (const o of ops) {
      if ((o.t === "set" || o.t === "cset") && isColl(o.coll)) {
        needed.set(o.coll + "/" + o.id, ["row", o.coll, o.id]);
      }
    }
    // 한 묶음에 들어오는 줄 수는 보통 한둘이라 하나씩 읽어도 충분하다
    const existing = new Map<string, Row>();
    for (const [k, key] of needed) {
      const got = await kv.get<Row>(key);
      if (got.value) existing.set(k, got.value);
    }

    const next: State = { ...st };
    const writes: { key: Deno.KvKey; value: unknown }[] = [];
    const dels: Deno.KvKey[] = [];
    let metaPatch: Record<string, unknown> | null = null;

    for (const o of ops) {
      if (!o || typeof o !== "object") continue;

      if (o.t === "set" || o.t === "cset") {
        if (!isColl(o.coll)) continue;
        const cur = existing.get(o.coll + "/" + o.id);
        if (!cur) continue;                       // 이미 지워진 줄이면 무시
        const row: Row = { ...cur };
        if (o.t === "cset") {
          const c = { ...((row.contract as Record<string, unknown>) || {}) };
          for (const k of Object.keys(o.f || {})) c[k] = o.f[k];
          row.contract = c;
        } else {
          for (const k of Object.keys(o.f || {})) row[k] = o.f[k];
        }
        existing.set(o.coll + "/" + o.id, row);   // 같은 묶음에 두 번 나와도 누적되게
        writes.push({ key: ["row", o.coll, o.id], value: row });
        continue;
      }

      if (o.t === "add") {
        if (!isColl(o.coll)) continue;
        const rows = o.rows || (o.row ? [o.row] : []);
        // 맨 위에 넣을 때는 역순으로 번호를 매겨야 보낸 순서대로 위에서 아래로 놓인다
        const list = o.top ? [...rows].reverse() : rows;
        for (const r of list) {
          if (!r || r.id == null) continue;
          const ord = o.top ? --next.ordLo : next.ordHi++;
          writes.push({ key: ["row", o.coll, r.id], value: { ...r, _ord: ord } });
          const nk = NEXT_KEY[o.coll];
          if (Number(r.id) >= next[nk]) next[nk] = Number(r.id) + 1;
        }
        continue;
      }

      if (o.t === "del") {
        if (!isColl(o.coll)) continue;
        for (const id of o.ids || []) dels.push(["row", o.coll, id]);
        continue;
      }

      if (o.t === "meta") {
        metaPatch = { ...(metaPatch || {}), ...(o.f || {}) };
        continue;
      }
    }

    // 설정은 조각내어 담기 때문에 원자적 묶음에 넣지 않고 따로 저장한다.
    // (설정 변경은 이름 등록처럼 드물게 일어나고, 서로 겹칠 일이 없다)
    let metaToWrite: Record<string, unknown> | null = null;
    if (metaPatch) {
      const cur = await getDoc<Record<string, unknown>>("meta", DEFAULT_META);
      metaToWrite = { ...cur, ...metaPatch };
    }

    const rev = st.rev + 1;
    next.rev = rev;
    const line = { rev, by: user || "", cid: cid || "", at: new Date().toISOString().slice(0, 19), ops };

    // 첫 묶음에 "상태가 그대로일 때만 저장" 조건을 건다 → 시점이 겹치지 않는다
    const total = writes.length + dels.length + 2;
    let ok = true;
    if (total <= MAX_MUTATIONS) {
      let at = kv.atomic().check({ key: ["state"], versionstamp });
      for (const w of writes) at = at.set(w.key, w.value);
      for (const d of dels) at = at.delete(d);
      at = at.set(["ops", rev], line).set(["state"], next);
      ok = (await at.commit()).ok;
    } else {
      // 아주 큰 묶음(대량 삭제 등)은 나눠서 저장한다.
      const head = kv.atomic().check({ key: ["state"], versionstamp }).set(["state"], next);
      ok = (await head.commit()).ok;
      if (ok) {
        await putBatched(writes);
        await delBatched(dels);
        await kv.set(["ops", rev], line);
      }
    }

    if (ok) {
      if (metaToWrite) await setDoc("meta", metaToWrite);
      pruneOps(next).catch(() => {});
      return rev;
    }
    // 다른 사람이 한 발 먼저 저장했다 → 잠깐 쉬고 다시
    await new Promise((r) => setTimeout(r, 20 + attempt * 30));
  }
  throw new Error("busy");
}

// 오래된 변경기록 지우기 (저장소를 계속 먹지 않게)
let pruning = false;
async function pruneOps(st: State) {
  if (pruning) return;
  const target = st.rev - OPS_KEEP;
  if (target <= st.floor) return;
  pruning = true;
  try {
    let at = kv.atomic();
    let n = 0;
    for (let r = st.floor + 1; r <= target; r++) {
      at = at.delete(["ops", r]);
      if (++n >= MAX_MUTATIONS) break;
    }
    await at.commit();
    const cur = await getState();
    await kv.set(["state"], { ...cur.value, floor: st.floor + n });
  } finally {
    pruning = false;
  }
}

// ==================================================================
//  전체 자료 만들기 / 갈아끼우기
// ==================================================================
async function buildSnapshot() {
  const out: Record<string, unknown> = {};
  const st = (await getState()).value;

  const meta = await getDoc<Record<string, unknown>>("meta", DEFAULT_META);
  const companies = await getDoc<unknown>("companies", []);

  out.meta = meta;
  for (const coll of COLLS) {
    const rows: Row[] = [];
    for await (const e of kv.list<Row>({ prefix: ["row", coll] }, { batchSize: 500 })) {
      if (e.value) rows.push(e.value);
    }
    // 화면에 보이는 순서는 _ord 가 정한다 (새 문의가 맨 위)
    rows.sort((a, b) => Number(a._ord ?? 0) - Number(b._ord ?? 0));
    out[NEXT_KEY[coll]] = st[NEXT_KEY[coll]];
    out[coll] = rows.map((r) => {
      const { _ord: _drop, ...rest } = r;
      return rest;
    });
  }
  out.companies = companies;
  return { snapshot: out, rev: st.rev };
}

// 큰 변경(엑셀 대량등록 등). 기존 줄을 모두 지우고 새로 넣는다.
async function replaceSnapshot(doc: Record<string, unknown>) {
  const { value: st } = await getState();

  for (const coll of COLLS) {
    const kill: Deno.KvKey[] = [];
    for await (const e of kv.list({ prefix: ["row", coll] }, { batchSize: 500 })) kill.push(e.key);
    await delBatched(kill);
  }

  const next: State = { ...st };
  let ord = 1;
  for (const coll of COLLS) {
    const rows = Array.isArray(doc[coll]) ? (doc[coll] as Row[]) : [];
    const puts: { key: Deno.KvKey; value: unknown }[] = [];
    for (const r of rows) {
      if (!r || r.id == null) continue;
      puts.push({ key: ["row", coll, r.id], value: { ...r, _ord: ord++ } });
      const nk = NEXT_KEY[coll];
      if (Number(r.id) >= next[nk]) next[nk] = Number(r.id) + 1;
    }
    await putBatched(puts);
    const nk = NEXT_KEY[coll];
    const given = Number(doc[nk]);
    if (given && given > next[nk]) next[nk] = given;
  }
  if (doc.meta) await setDoc("meta", doc.meta);
  if (doc.companies) await setDoc("companies", doc.companies);

  // 변경기록을 전부 정리하고, 모든 직원이 전체를 다시 받도록 바닥(floor)을 올린다
  const kill: Deno.KvKey[] = [];
  for await (const e of kv.list({ prefix: ["ops"] }, { batchSize: 500 })) kill.push(e.key);
  await delBatched(kill);

  next.rev = st.rev + 1;
  next.ordLo = 0;
  next.ordHi = ord;
  next.floor = next.rev;
  await kv.set(["state"], next);
  return next.rev;
}

// ==================================================================
//  첨부파일 (KV 한 칸이 64KB 라 조각내어 담는다)
// ==================================================================
const IMG_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
const FILE_EXT = [
  ...IMG_EXT, ".pdf", ".hwp", ".hwpx", ".doc", ".docx", ".xls", ".xlsx", ".xlsm",
  ".csv", ".ppt", ".pptx", ".txt", ".rtf", ".ai", ".psd", ".eps", ".svg", ".zip",
];
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": JSON_TYPE, ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".bmp": "image/bmp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
  ".pdf": "application/pdf", ".map": JSON_TYPE, ".txt": "text/plain; charset=utf-8",
};

function extOf(name: string) {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}

async function saveBlob(name: string, bytes: Uint8Array, type: string, orig: string) {
  const parts = Math.ceil(bytes.length / CHUNK) || 1;
  for (let i = 0; i < parts; i++) {
    await kv.set(["blob", name, i], bytes.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  await kv.set(["blobmeta", name], { parts, type, orig, size: bytes.length });
}

async function readBlob(name: string) {
  const m = (await kv.get<{ parts: number; type: string; size: number }>(["blobmeta", name])).value;
  if (!m) return null;
  const buf = new Uint8Array(m.size);
  let at = 0;
  for (let i = 0; i < m.parts; i++) {
    const c = (await kv.get<Uint8Array>(["blob", name, i])).value;
    if (!c) return null;
    buf.set(c, at);
    at += c.length;
  }
  return { bytes: buf, type: m.type };
}

async function handleUpload(req: Request, allowed: string[], prefix: string, limit: number) {
  const raw = req.headers.get("X-File-Name") || "";
  let orig = "";
  try { orig = decodeURIComponent(raw); } catch { orig = raw; }
  const ext = extOf(orig);
  if (!allowed.includes(ext)) {
    return jsonRes({ ok: false, error: prefix === "img" ? "이미지 파일만 첨부할 수 있습니다." : "허용되지 않는 파일 형식입니다." }, 400);
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return jsonRes({ ok: false, error: "빈 파일" }, 400);
  if (bytes.length > limit) {
    return jsonRes({ ok: false, error: Math.round(limit / 1048576) + "MB 이하만 첨부할 수 있습니다." }, 400);
  }
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  const name = prefix + "_" + stamp + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8) + ext;
  await saveBlob(name, bytes, MIME[ext] || "application/octet-stream", orig || name);
  return jsonRes({ ok: true, file: "uploads/" + name, name: orig || name });
}

// ==================================================================
//  정적 파일 (index.html · app.js) — 저장소에 있는 파일을 그대로 내보낸다
// ==================================================================
const BLOCKED = new Set([
  "admin.config.json", "serve.ps1", "data.json", "data.backup.json",
  "ops.jsonl", "state.json", "data.sample.json",
]);

async function serveStatic(rel: string) {
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.includes("..") || BLOCKED.has(rel)) return textRes("Forbidden", 403);
  try {
    const url = new URL("../" + rel, import.meta.url);
    const body = await Deno.readFile(url);
    return new Response(body, {
      headers: {
        "content-type": MIME[extOf(rel)] || "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return textRes("404 Not Found", 404);
  }
}

// ==================================================================
//  요청 처리
// ==================================================================
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = decodeURIComponent(url.pathname);
  const method = req.method;

  // ---------- 첨부파일 내려받기 ----------
  if (path.startsWith("/uploads/")) {
    const got = await readBlob(path.slice("/uploads/".length));
    if (!got) return textRes("404 Not Found", 404);
    return new Response(got.bytes, {
      headers: { "content-type": got.type, "cache-control": "public, max-age=31536000" },
    });
  }

  if (!path.startsWith("/api/")) return serveStatic(path.replace(/^\//, ""));

  // ---------- 로그인 ----------
  if (path === "/api/login" && method === "POST") {
    let pw = "";
    try { pw = String((await req.json()).password || ""); } catch { /* 잘못된 본문 */ }
    if (ADMIN_PASSWORD && pw === ADMIN_PASSWORD) return jsonRes({ ok: true, token: ADMIN_PASSWORD });
    if (LINK_KEY && pw === LINK_KEY) return jsonRes({ ok: true, token: LINK_KEY });
    return jsonRes({ ok: false, error: "invalid password" }, 401);
  }

  // 비밀번호로 들어오든 직원 링크 열쇠로 들어오든 똑같이 인정한다
  const token = req.headers.get("X-Admin-Token") || "";
  const authed = !!token && ((!!ADMIN_PASSWORD && token === ADMIN_PASSWORD) || (!!LINK_KEY && token === LINK_KEY));
  if (!authed) return jsonRes({ ok: false, error: "unauthorized" }, 401);

  try {
    if (path === "/api/linkkey" && method === "GET") {
      if (!LINK_KEY) return jsonRes({ ok: false, error: "no link key" }, 404);
      return jsonRes({ ok: true, key: LINK_KEY });
    }

    // 전체 자료 내려주기. 이 응답이 담고 있는 시점은 X-Rev 로 알려준다
    if (path === "/api/data" && method === "GET") {
      const { snapshot, rev } = await buildSnapshot();
      return new Response(JSON.stringify(snapshot), {
        headers: { "content-type": JSON_TYPE, "X-Rev": String(rev), "cache-control": "no-store" },
      });
    }

    // 내가 본 시점 이후 남이 바꾼 것만 받아간다
    if (path === "/api/changes" && method === "GET") {
      const since = Number(url.searchParams.get("since") || 0) || 0;
      const st = (await getState()).value;
      if (since < st.floor) return jsonRes({ ok: true, reload: true, rev: st.rev });
      const lines: unknown[] = [];
      if (since < st.rev) {
        for await (const e of kv.list({ start: ["ops", since + 1], end: ["ops", st.rev + 1] })) {
          if (e.value) lines.push(e.value);
        }
      }
      return jsonRes({ ok: true, rev: st.rev, lines });
    }

    // 변경 한 묶음 기록
    if (path === "/api/patch" && method === "POST") {
      let ops: Op[];
      try { ops = await req.json(); } catch { return jsonRes({ ok: false, error: "invalid json" }, 400); }
      if (!Array.isArray(ops)) return jsonRes({ ok: false, error: "ops array required" }, 400);
      const st = (await getState()).value;
      if (ops.length === 0) return jsonRes({ ok: true, rev: st.rev });
      let user = req.headers.get("X-User") || "";
      try { user = decodeURIComponent(user); } catch { /* 그대로 둔다 */ }
      const rev = await commitOps(ops, user, req.headers.get("X-Client") || "");
      return jsonRes({ ok: true, rev });
    }

    // 새 줄에 붙일 id 발급 (직원끼리 같은 번호를 쓰지 않게)
    if (path === "/api/newid" && method === "POST") {
      let key = "", n = 1;
      try {
        const q = await req.json();
        key = String(q.key || "");
        if (q.n) n = Number(q.n);
      } catch { /* 기본값 */ }
      if (!["nextId", "nextGenId", "nextNoticeId"].includes(key)) {
        return jsonRes({ ok: false, error: "unknown key" }, 400);
      }
      if (!(n >= 1)) n = 1;
      if (n > 20000) n = 20000;
      for (let attempt = 0; attempt < 8; attempt++) {
        const { value: st, versionstamp } = await getState();
        const start = st[key as "nextId"];
        const next = { ...st, [key]: start + n };
        const ok = (await kv.atomic().check({ key: ["state"], versionstamp }).set(["state"], next).commit()).ok;
        if (ok) return jsonRes({ ok: true, start, n });
        await new Promise((r) => setTimeout(r, 20 + attempt * 30));
      }
      return jsonRes({ ok: false, error: "busy" }, 503);
    }

    // 전체 갈아끼우기. 그 사이 남이 바꿨으면 거절한다(409) → 앱이 최신을 받아 합친 뒤 다시 보낸다
    if (path === "/api/save" && method === "POST") {
      let doc: Record<string, unknown>;
      try { doc = await req.json(); } catch { return jsonRes({ ok: false, error: "invalid json" }, 400); }
      const cli = req.headers.get("X-Rev");
      const st = (await getState()).value;
      if (cli !== null && cli !== "" && Number(cli) !== st.rev) {
        return jsonRes({ ok: false, stale: true, rev: st.rev }, 409);
      }
      const rev = await replaceSnapshot(doc);
      return jsonRes({ ok: true, rev });
    }

    // ------------------------------------------------------------------
    //  처음 한 번, 내 PC 의 data.json 을 클라우드로 옮길 때 쓰는 통로.
    //
    //  /api/save 처럼 한 번에 다 보내면 4,700건을 한 요청에서 처리하느라
    //  무료 등급의 처리시간 한도를 넘긴다. 그래서 몇 백 건씩 나눠 받는다.
    // ------------------------------------------------------------------
    if (path === "/api/import" && method === "POST") {
      let q: Record<string, unknown>;
      try { q = await req.json(); } catch { return jsonRes({ ok: false, error: "invalid json" }, 400); }
      const step = String(q.step || "");

      if (step === "begin") {
        for (const coll of COLLS) {
          const kill: Deno.KvKey[] = [];
          for await (const e of kv.list({ prefix: ["row", coll] }, { batchSize: 500 })) kill.push(e.key);
          await delBatched(kill);
        }
        const kill: Deno.KvKey[] = [];
        for await (const e of kv.list({ prefix: ["ops"] }, { batchSize: 500 })) kill.push(e.key);
        await delBatched(kill);
        const st = (await getState()).value;
        const rev = st.rev + 1;
        await kv.set(["state"], { ...st, rev, floor: rev, ordLo: 0, ordHi: 1 });
        return jsonRes({ ok: true, rev });
      }

      if (step === "rows") {
        const coll = q.coll;
        if (!isColl(coll)) return jsonRes({ ok: false, error: "unknown coll" }, 400);
        const rows = Array.isArray(q.rows) ? (q.rows as Row[]) : [];
        const st = (await getState()).value;
        let ord = st.ordHi;
        const puts: { key: Deno.KvKey; value: unknown }[] = [];
        const nk = NEXT_KEY[coll];
        let maxId = st[nk];
        for (const r of rows) {
          if (!r || r.id == null) continue;
          puts.push({ key: ["row", coll, r.id], value: { ...r, _ord: ord++ } });
          if (Number(r.id) >= maxId) maxId = Number(r.id) + 1;
        }
        await putBatched(puts);
        await kv.set(["state"], { ...st, ordHi: ord, [nk]: maxId });
        return jsonRes({ ok: true, added: puts.length, ordHi: ord });
      }

      if (step === "docs") {
        if (q.meta) await setDoc("meta", q.meta);
        if (q.companies) await setDoc("companies", q.companies);
        return jsonRes({ ok: true });
      }

      if (step === "end") {
        const st = (await getState()).value;
        const next = { ...st };
        for (const coll of COLLS) {
          const nk = NEXT_KEY[coll];
          const given = Number(q[nk]);
          if (given && given > next[nk]) next[nk] = given;
        }
        await kv.set(["state"], next);
        return jsonRes({ ok: true, rev: next.rev });
      }

      return jsonRes({ ok: false, error: "unknown step" }, 400);
    }

    if (path === "/api/upload" && method === "POST") {
      return await handleUpload(req, IMG_EXT, "img", 10 * 1024 * 1024);
    }
    if (path === "/api/upload-file" && method === "POST") {
      return await handleUpload(req, FILE_EXT, "file", 50 * 1024 * 1024);
    }

    return jsonRes({ ok: false, error: "not found" }, 404);
  } catch (e) {
    // 무엇이 잘못됐는지 바로 알 수 있게 오류 문구를 함께 돌려준다.
    // (KV·서버 자체의 오류 문구라 고객정보는 들어가지 않는다)
    console.error(path, e);
    const msg = e instanceof Error ? e.message : String(e);
    return jsonRes({ ok: false, error: "server error", detail: msg }, 500);
  }
});
