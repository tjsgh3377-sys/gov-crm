/* 정부지원사업 고객관리 — 대시보드 로직 */
(function () {
  "use strict";

  var CONTRACT = ["계약", "진행중", "미계약"];
  var CHANNELS = ["전화", "이메일", "채널톡", "카카오톡", "홈페이지", "소개", "기타"];

  var TOKEN = sessionStorage.getItem("govToken") || "";
  var DATA = null;
  var dirty = false;
  var curTab = "customers";
  var workspace = "gov"; // "gov"=정부지원사업, "gen"=일반고객
  // 워크스페이스별 필터/상태를 따로 보관 (분류값이 서로 달라 전환 시 섞이지 않도록)
  var cFilters = {
    gov: { cat: "__all", contract: "__all", q: "", year: "__all", month: "__all" },
    gen: { cat: "__all", contract: "__all", q: "", year: "__all", month: "__all" }
  };
  var nFilter = { program: "__all", year: "__all", month: "__all" };
  var statsYears = { gov: null, gen: null };
  // 대량 데이터(수천 건) 렉 방지: 문의·계약 표를 페이지 단위로 렌더
  var custPage = { gov: 1, gen: 1 };
  var CUST_PAGE_SIZE = 100;
  // 선택 삭제용 체크 상태 (id → true). 페이지를 넘겨도 유지되지만, 보이는 범위(필터·검색·분류탭)가
  // 바뀌면 안 보이는 항목을 지우게 되므로 선택을 비운다.
  var custSel = { gov: {}, gen: {} };
  function resetCustPage() { custPage[workspace] = 1; clearSel(); }
  function selMap() { return custSel[workspace]; }
  function clearSel() { custSel[workspace] = {}; }
  // 목록에 실제로 남아있는 id만 돌려준다(삭제·필터 변경으로 생긴 잔여 선택 정리)
  function selIds() {
    var m = selMap(), out = [];
    curList().forEach(function (c) { if (m[c.id]) out.push(c.id); });
    return out;
  }
  function deleteCustomers(ids) {
    var kill = {};
    ids.forEach(function (id) { kill[id] = true; delete selMap()[id]; });
    DATA[ws().list] = curList().filter(function (c) { return !kill[c.id]; });
  }

  // ===== 홈페이지 유지보수 탭 상태/상수 =====
  var MENUS = ["홈·기본정보", "회사소개", "제품소개", "사업영역", "기술력",
    "인증·오시는 길", "문의·CTA", "커뮤니티"];
  var STATUS = [
    { v: "",      label: "대기",   cls: "" },
    { v: "요청",   label: "요청",   cls: "req" },
    { v: "확인중", label: "확인중", cls: "doing" },
    { v: "완료",   label: "완료",   cls: "done" },
    { v: "보류",   label: "보류",   cls: "hold" }
  ];
  function statusCls(v) { for (var i = 0; i < STATUS.length; i++) if (STATUS[i].v === v) return STATUS[i].cls; return ""; }
  var PAGE_MAP = {
    company: "index.html", nav: "index.html", hero: "index.html", footer: "index.html", images: "index.html",
    about: "about.html", products: "products.html", business: "business.html",
    technology: "index.html", techPage: "technology.html",
    certifications: "cert.html", location: "location.html",
    contactPage: "contact.html", cta: "index.html", community: "community.html"
  };
  var MENU_PAGE = {
    "홈·기본정보": "index.html", "회사소개": "about.html", "제품소개": "products.html",
    "사업영역": "business.html", "기술력": "technology.html",
    "인증·오시는 길": "cert.html", "문의·CTA": "contact.html", "커뮤니티": "community.html"
  };
  var PAGE_LABEL = {
    "index.html": "홈(메인)", "about.html": "회사소개", "products.html": "제품소개",
    "business.html": "사업영역", "technology.html": "기술력", "cert.html": "인증·특허",
    "location.html": "오시는 길", "contact.html": "문의하기", "community.html": "커뮤니티"
  };
  var mntSelId = null;
  var mntFilter = { menu: "", status: "__all", q: "", onlyReq: false };

  // 현재 워크스페이스 설정 (목록 키·분류 필드·분류 목록·라벨)
  function ws() {
    if (workspace === "gen") {
      return { list: "genCustomers", nextIdKey: "nextGenId", catField: "category",
        cats: (DATA.meta.categories || []), catLabel: "분류", allLabel: "전체 분류", noun: "일반고객" };
    }
    return { list: "customers", nextIdKey: "nextId", catField: "program",
      cats: (DATA.meta.programs || []), catLabel: "지원사업", allLabel: "전체 지원사업", noun: "정부지원사업 고객" };
  }
  function curList() { return DATA[ws().list]; }
  function cf() { return cFilters[workspace]; }

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) { if (k === "class") e.className = attrs[k]; else e.setAttribute(k, attrs[k]); }
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function today() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function won(n) { n = Number(n) || 0; return n.toLocaleString("ko-KR") + "원"; }
  function programs() { return (DATA && DATA.meta && DATA.meta.programs) || []; }
  function cats() { return ws().cats; }
  function markDirty() { dirty = true; var m = $("saveMsg"); m.className = "msg dirty"; m.textContent = "● 저장하지 않은 변경사항이 있습니다"; }
  function clearDirty(msg) { dirty = false; var m = $("saveMsg"); m.className = "msg ok"; m.textContent = msg || ""; }

  function api(path, method, body) {
    return fetch(path, {
      method: method || "GET",
      headers: { "X-Admin-Token": TOKEN, "Content-Type": "application/json" },
      body: body != null ? body : undefined
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  }

  // ===== 정적 모드 (serve.ps1 없이 GitHub Pages 등에서 열린 경우) =====
  // 서버가 없으면 사용자가 data.json을 직접 열고, 저장은 같은 파일에 다시 쓴다(미지원 브라우저는 내려받기).
  var STATIC = false;
  var STATIC_TEXT = null;   // 마지막으로 읽거나 저장한 JSON 원문 (되돌리기용)
  var fileHandle = null;
  var fileName = "data.json";
  var canFS = (typeof window.showOpenFilePicker === "function");

  function probeServer(cb) {
    var done = false;
    var t = setTimeout(function () { if (!done) { done = true; cb(false); } }, 3000);
    fetch("/api/data", { headers: { "X-Admin-Token": "__probe__" } })
      .then(function (r) {
        var ct = r.headers.get("content-type") || "";
        return (r.status === 200 || r.status === 401) && ct.indexOf("json") >= 0;
      })
      .catch(function () { return false; })
      .then(function (ok) { if (done) return; done = true; clearTimeout(t); cb(ok); });
  }

  // 파일 핸들 보관용 (다음 방문 때 "최근 파일 이어서 열기")
  function idbStore(mode, fn) {
    try {
      var rq = indexedDB.open("govsupport", 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
      rq.onsuccess = function () { fn(rq.result.transaction("kv", mode).objectStore("kv")); };
    } catch (e) { /* 시크릿 모드 등 */ }
  }
  function idbSet(k, v) { idbStore("readwrite", function (s) { s.put(v, k); }); }
  function idbGet(k, cb) {
    var answered = false;
    setTimeout(function () { if (!answered) { answered = true; cb(null); } }, 1500);
    idbStore("readonly", function (s) {
      var r = s.get(k);
      r.onsuccess = function () { if (!answered) { answered = true; cb(r.result || null); } };
    });
  }

  function staticErr(msg) { var e = $("loginErr"); if (e) e.textContent = msg || ""; }

  function setupStaticMode() {
    var card = document.querySelector("#login .login-card");
    card.innerHTML =
      '<div class="logo">고객관리 센터</div>' +
      '<div class="sub">내 PC의 <b>data.json</b> 파일을 열어 편집합니다.<br>' +
      '데이터는 서버로 전송되지 않고 이 브라우저 안에서만 처리됩니다.</div>' +
      '<button class="btn" id="fOpenBtn" style="width:100%;margin-top:16px;">📂 data.json 열기</button>' +
      '<button class="btn ghost" id="fRecentBtn" style="width:100%;margin-top:8px;display:none;">↩ 최근 파일 이어서 열기</button>' +
      '<button class="btn ghost" id="fNewBtn" style="width:100%;margin-top:8px;">＋ 빈 데이터로 시작</button>' +
      '<input type="file" id="fInput" accept=".json,application/json" style="display:none">' +
      '<div id="loginErr" class="msg err" style="font-size:13px;margin:12px 0 0;min-height:16px;"></div>' +
      (canFS ? "" : '<div class="sub" style="margin-top:12px;font-size:12px;">이 브라우저는 파일 제자리 저장을 지원하지 않습니다. ' +
        '저장 시 data.json이 새로 <b>내려받아지며</b>, 원본 파일을 교체해 주세요. (Chrome·Edge 권장)</div>');

    $("fOpenBtn").onclick = staticOpen;
    $("fNewBtn").onclick = function () {
      if (!confirm("빈 데이터로 시작합니다. 기존 파일은 변경되지 않습니다.")) return;
      fileHandle = null; fileName = "data.json";
      STATIC_TEXT = JSON.stringify({ meta: { title: "고객관리 센터", programs: ["수출바우처", "혁신바우처", "소공인판로개척지원사업", "기타정부사업"], categories: ["기고객", "신규고객"] } });
      enterApp();
    };
    $("fInput").addEventListener("change", function () {
      var f = this.files && this.files[0];
      this.value = "";
      if (f) readJsonFile(f);
    });
    if (canFS) {
      idbGet("handle", function (h) {
        if (!h) return;
        var b = $("fRecentBtn"); if (!b) return;
        b.textContent = "↩ 최근 파일 이어서 열기 (" + (h.name || "data.json") + ")";
        b.style.display = "";
        b.onclick = function () {
          ensurePerm(h, "read").then(function (ok) {
            if (!ok) { staticErr("파일 접근 권한이 필요합니다. '📂 data.json 열기'로 다시 선택하세요."); return; }
            setHandle(h);
          });
        };
      });
    }
  }

  function staticOpen() {
    staticErr("");
    if (!canFS) { $("fInput").click(); return; }
    window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "고객관리 데이터", accept: { "application/json": [".json"] } }]
    }).then(function (hs) { setHandle(hs[0]); })
      .catch(function () { /* 사용자가 취소 */ });
  }

  function setHandle(h) {
    fileHandle = h;
    fileName = h.name || "data.json";
    idbSet("handle", h);
    h.getFile().then(readJsonFile).catch(function () { staticErr("파일을 읽을 수 없습니다."); });
  }

  function readJsonFile(f) {
    fileName = f.name || fileName;
    var fr = new FileReader();
    fr.onload = function () {
      var j = null;
      try { j = JSON.parse(fr.result); } catch (e) {
        staticErr("JSON 형식이 아닙니다. 고객관리 센터의 data.json인지 확인하세요.");
        return;
      }
      if (!j || typeof j !== "object" || Array.isArray(j)) { staticErr("고객관리 센터의 data.json이 아닙니다."); return; }
      STATIC_TEXT = fr.result;
      enterApp();
    };
    fr.onerror = function () { staticErr("파일을 읽는 중 오류가 발생했습니다."); };
    fr.readAsText(f, "utf-8");
  }

  function ensurePerm(h, mode) {
    mode = mode || "readwrite";
    if (!h || !h.queryPermission) return Promise.resolve(true);
    return h.queryPermission({ mode: mode }).then(function (p) {
      if (p === "granted") return true;
      return h.requestPermission({ mode: mode }).then(function (p2) { return p2 === "granted"; });
    }).catch(function () { return false; });
  }

  function staticSave() {
    var txt = JSON.stringify(DATA);
    var btn = $("saveBtn");
    if (!(fileHandle && fileHandle.createWritable)) { staticDownload(txt); return; }
    btn.disabled = true;
    ensurePerm(fileHandle, "readwrite").then(function (ok) {
      if (!ok) { btn.disabled = false; staticDownload(txt); return null; }
      return fileHandle.createWritable().then(function (w) {
        return w.write(new Blob([txt], { type: "application/json" })).then(function () { return w.close(); });
      }).then(function () {
        btn.disabled = false;
        STATIC_TEXT = txt;
        clearDirty("✓ " + fileName + " 에 저장되었습니다 (" + new Date().toLocaleTimeString("ko-KR") + ")");
      });
    }).catch(function () { btn.disabled = false; staticDownload(txt); });
  }

  function staticDownload(txt) {
    STATIC_TEXT = txt;
    triggerDownload(new Blob([txt], { type: "application/json" }), fileName || "data.json");
    clearDirty("✓ " + (fileName || "data.json") + " 내려받기 완료 — 원본 파일을 이 파일로 교체하세요");
  }

  function fileToDataUrl(file, limitMb, cb) {
    if (file.size > limitMb * 1024 * 1024) { cb(new Error("파일이 너무 큽니다 (최대 " + limitMb + "MB)")); return; }
    var fr = new FileReader();
    fr.onload = function () { cb(null, fr.result); };
    fr.onerror = function () { cb(new Error("파일을 읽을 수 없습니다.")); };
    fr.readAsDataURL(file);
  }

  // ---------- 로그인 ----------
  function doLogin() {
    var pw = $("pw").value;
    $("loginErr").textContent = "";
    fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j.ok) {
          TOKEN = res.j.token || pw;
          sessionStorage.setItem("govToken", TOKEN);
          enterApp();
        } else {
          $("loginErr").textContent = "비밀번호가 올바르지 않습니다.";
        }
      })
      .catch(function () { $("loginErr").textContent = "서버에 연결할 수 없습니다."; });
  }

  function enterApp() {
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
    loadData();
  }

  function loadData() {
    if (STATIC) {
      if (fileHandle && fileHandle.getFile) {
        fileHandle.getFile().then(function (f) {
          var fr = new FileReader();
          fr.onload = function () {
            try { JSON.parse(fr.result); STATIC_TEXT = fr.result; } catch (e) { /* 직전 상태 유지 */ }
            applyStaticText();
          };
          fr.readAsText(f, "utf-8");
        }).catch(applyStaticText);
      } else {
        applyStaticText();
      }
      return;
    }
    api("/api/data", "GET").then(function (res) {
      if (res.status === 401) { logout(); return; }
      applyData(res.j || {});
    });
  }

  function applyStaticText() {
    var obj = {};
    try { obj = JSON.parse(STATIC_TEXT || "{}"); } catch (e) { obj = {}; }
    applyData(obj);
  }

  function applyData(obj) {
    DATA = obj || {};
    DATA.meta = DATA.meta || { programs: [] };
    DATA.meta.programs = DATA.meta.programs || [];
    DATA.meta.categories = DATA.meta.categories || ["기고객", "신규고객"];
    DATA.customers = DATA.customers || [];
    DATA.genCustomers = DATA.genCustomers || [];
    DATA.notices = DATA.notices || [];
    DATA.nextId = DATA.nextId || 1;
    DATA.nextGenId = DATA.nextGenId || 1;
    DATA.nextNoticeId = DATA.nextNoticeId || 1;
    DATA.companies = DATA.companies || [];
    if (!mntSelId && DATA.companies.length) mntSelId = DATA.companies[0].id;
    clearDirty("");
    render();
  }

  function logout() {
    if (STATIC) {
      if (dirty && !confirm("저장하지 않은 변경사항이 사라집니다. 파일을 닫을까요?")) return;
      DATA = null; STATIC_TEXT = null; dirty = false;
      $("app").classList.add("hidden"); $("login").classList.remove("hidden");
      staticErr("");
      return;
    }
    sessionStorage.removeItem("govToken"); TOKEN = "";
    $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  }

  function save() {
    if (STATIC) { staticSave(); return; }
    var btn = $("saveBtn"); btn.disabled = true;
    api("/api/save", "POST", JSON.stringify(DATA)).then(function (res) {
      btn.disabled = false;
      if (res.status === 200 && res.j.ok) { clearDirty("✓ 저장되었습니다 (" + new Date().toLocaleTimeString("ko-KR") + ")"); }
      else { var m = $("saveMsg"); m.className = "msg err"; m.textContent = "저장 실패: " + (res.j.error || res.status); }
    }).catch(function () { btn.disabled = false; var m = $("saveMsg"); m.className = "msg err"; m.textContent = "저장 중 오류가 발생했습니다."; });
  }

  // ---------- 탭 전환 ----------
  function switchTab(t) {
    curTab = t;
    render();
  }

  // ---------- 렌더 ----------
  function render() {
    if (!DATA) return;
    var isMaint = (workspace === "maint");
    // 유지보수는 워크스페이스(대분류)라 상단 탭 바를 숨기고 전용 화면을 띄움
    var tabsBar = document.querySelector(".tabs");
    if (tabsBar) tabsBar.classList.toggle("hidden", isMaint);
    $("tab-maint").classList.toggle("hidden", !isMaint);
    ["customers", "stats", "notices"].forEach(function (x) {
      $("tab-" + x).classList.toggle("hidden", isMaint || x !== curTab);
    });
    document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === curTab); });
    if (isMaint) { renderMaint(); return; }
    refreshWho();
    if (curTab === "customers") renderCustomers();
    else if (curTab === "stats") renderStats();
    else renderNotices();
  }

  // ---------- 워크스페이스 전환 ----------
  function switchWorkspace(w) {
    if (w === workspace) return;
    workspace = w;
    document.querySelectorAll(".wsbtn").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-ws") === w); });
    render();
  }

  // ===== 문의·계약 관리 =====
  function filteredCustomers() {
    var f = cf(), catField = ws().catField;
    var q = f.q.trim().toLowerCase();
    return curList().filter(function (c) {
      if (f.cat !== "__all" && c[catField] !== f.cat) return false;
      if (f.contract !== "__all" && c.contracted !== f.contract) return false;
      if (f.year !== "__all" && String(c.date).slice(0, 4) !== f.year) return false;
      if (f.month !== "__all" && String(parseInt(String(c.date).slice(5, 7), 10) || 0) !== f.month) return false;
      if (q) {
        var hay = [c.company, c.manager, c.contact, c.email, c.inquiry, c.note].join(" ").toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  // 분류 하위 탭 (gen=기고객/신규고객, gov=지원사업) — 여기서 선택한 분류가 필터 겸 새 행 기본 분류
  function renderCatSubtabs(host) {
    var f = cf(), catField = ws().catField, list = curList();
    var bar = el("div", { class: "subtabs" });
    var total = list.length;
    var html = '<button class="subtab' + (f.cat === "__all" ? " active" : "") + '" data-cat="__all">전체 <span class="cnt">' + total + '</span></button>';
    cats().forEach(function (p) {
      var cnt = list.filter(function (c) { return c[catField] === p; }).length;
      html += '<button class="subtab' + (f.cat === p ? " active" : "") + '" data-cat="' + esc(p) + '">' + esc(p) + ' <span class="cnt">' + cnt + '</span></button>';
    });
    bar.innerHTML = '<span class="subtabs-label">' + esc(ws().catLabel) + '</span>' + html;
    host.appendChild(bar);
    bar.querySelectorAll(".subtab").forEach(function (b) {
      b.onclick = function () { cf().cat = this.getAttribute("data-cat"); resetCustPage(); renderCustomers(); };
    });
  }

  function refreshWho() {
    $("whoCount").textContent = ws().noun + " " + curList().length + "건 · 알림대상 " + DATA.notices.length + "곳";
  }

  function renderCustomers() {
    var host = $("tab-customers");
    host.innerHTML = "";
    refreshWho();

    // 분류(기고객/신규고객·지원사업) 하위 탭
    renderCatSubtabs(host);

    // 현재 필터가 적용된 목록 기준 통계 카드
    var rows = filteredCustomers();
    var nContract = rows.filter(function (c) { return c.contracted === "계약"; }).length;
    var nDoing = rows.filter(function (c) { return c.contracted === "진행중"; }).length;
    var sales = rows.reduce(function (s, c) { return s + (c.contracted === "계약" ? (Number(c.amount) || 0) : 0); }, 0);
    var f = cf();
    var scope =
      (f.year === "__all" ? "전체 연도" : f.year + "년") +
      (f.month === "__all" ? "" : " " + f.month + "월");

    var stats = el("div", { class: "stats" });
    stats.innerHTML =
      '<div class="stat total"><div class="n">' + rows.length + '</div><div class="l">' + esc(scope) + ' 문의</div></div>' +
      '<div class="stat done"><div class="n">' + nContract + '</div><div class="l">계약 완료</div></div>' +
      '<div class="stat doing"><div class="n">' + nDoing + '</div><div class="l">진행중</div></div>' +
      '<div class="stat sales"><div class="n">' + won(sales) + '</div><div class="l">계약 매출 합계</div></div>';
    host.appendChild(stats);

    // 툴바
    var tb = el("div", { class: "toolbar" });
    var contOpts = '<option value="__all">전체 계약여부</option>' + CONTRACT.map(function (p) { return '<option value="' + esc(p) + '"' + (f.contract === p ? " selected" : "") + ">" + esc(p) + "</option>"; }).join("");
    var yearsList = customerYears();
    var yearOpts = '<option value="__all">전체 연도</option>' + yearsList.map(function (y) { return '<option value="' + y + '"' + (f.year === y ? " selected" : "") + ">" + y + "년</option>"; }).join("");
    var monthOpts = '<option value="__all">전체 월</option>';
    for (var mi = 1; mi <= 12; mi++) { monthOpts += '<option value="' + mi + '"' + (f.month === String(mi) ? " selected" : "") + ">" + mi + "월</option>"; }
    tb.innerHTML =
      '<select id="fYear">' + yearOpts + '</select>' +
      '<select id="fMonth">' + monthOpts + '</select>' +
      '<select id="fContract">' + contOpts + '</select>' +
      '<input type="text" id="fQ" placeholder="업체명·담당자·내용 검색" value="' + esc(f.q) + '">' +
      '<span class="sp"></span>' +
      '<button class="btn ghost tiny" id="tplCust">⬇ 양식</button>' +
      '<label class="btn ghost tiny" for="fileCust" style="cursor:pointer">⬆ 엑셀 불러오기</label>' +
      '<input type="file" id="fileCust" accept=".xlsx,.xls" style="display:none">' +
      '<button class="btn tiny" id="addRow">+ 문의 추가</button>';
    host.appendChild(tb);

    // 선택 삭제 바 (선택된 항목이 있을 때만 보인다)
    var selbar = el("div", { class: "selbar hidden", id: "selBar" });
    selbar.innerHTML =
      '<span class="selcnt"><b id="selCnt">0</b>건 선택됨</span>' +
      '<button class="btn ghost tiny hidden" id="selAllFiltered"></button>' +
      '<button class="btn ghost tiny" id="selClear">선택 해제</button>' +
      '<button class="btn danger tiny" id="delSel">🗑 선택 삭제</button>';
    host.appendChild(selbar);

    // 페이지 계산 (대량 데이터 렉 방지)
    var total = rows.length;
    var pages = Math.max(1, Math.ceil(total / CUST_PAGE_SIZE));
    var pg = custPage[workspace]; if (pg > pages) pg = pages; if (pg < 1) pg = 1; custPage[workspace] = pg;
    var start = (pg - 1) * CUST_PAGE_SIZE;
    var pageRows = rows.slice(start, start + CUST_PAGE_SIZE);

    // 테이블
    var wrap = el("div", { class: "tablewrap" });
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">조건에 맞는 문의가 없습니다. “+ 문의 추가”로 새 고객을 등록하세요.</div>';
    } else {
      var table = el("table");
      table.innerHTML = "<thead><tr>" +
        '<th class="selcol"><input type="checkbox" id="selAll" title="이 페이지 전체선택"></th>' +
        "<th>번호</th><th>날짜</th><th>업체명</th><th>담당자</th><th>연락처</th>" +
        "<th>이메일</th><th>문의내용</th><th>문의경로</th><th>계약여부</th><th>견적금액</th><th>비고</th><th>계약내용</th><th></th>" +
        "</tr></thead>";
      var tbody = el("tbody");
      var catField = ws().catField;
      pageRows.forEach(function (c, i) {
        var tr = el("tr");
        tr.setAttribute("data-id", c.id);
        var picked = !!selMap()[c.id];
        if (picked) tr.className = "selrow";
        var chanOpts = CHANNELS.map(function (v) { return '<option value="' + esc(v) + '"' + (c.channel === v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
        var contOptsRow = CONTRACT.map(function (v) { return '<option value="' + esc(v) + '"' + (c.contracted === v ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
        var catTag = (cf().cat === "__all" && c[catField]) ? '<span class="cattag">' + esc(c[catField]) + '</span> ' : "";
        tr.innerHTML =
          '<td class="selcol"><input type="checkbox" class="rowsel"' + (picked ? " checked" : "") + '></td>' +
          '<td class="no">' + (start + i + 1) + '</td>' +
          '<td class="date"><input type="date" data-f="date" value="' + esc(c.date) + '"></td>' +
          '<td>' + catTag + '<input type="text" data-f="company" value="' + esc(c.company) + '" style="min-width:120px"></td>' +
          '<td><input type="text" data-f="manager" value="' + esc(c.manager) + '" style="min-width:70px"></td>' +
          '<td><input type="text" data-f="contact" value="' + esc(c.contact) + '" style="min-width:120px"></td>' +
          '<td><input type="email" data-f="email" value="' + esc(c.email) + '" style="min-width:150px"></td>' +
          '<td><textarea class="inq" data-f="inquiry">' + esc(c.inquiry) + '</textarea>' + imgStripHtml(c) + '</td>' +
          '<td><select data-f="channel">' + chanOpts + '</select></td>' +
          '<td><select class="contract" data-f="contracted">' + contOptsRow + '</select></td>' +
          '<td class="amt"><input type="number" data-f="amount" value="' + (Number(c.amount) || 0) + '" min="0" step="10000" style="min-width:110px"></td>' +
          '<td><input type="text" data-f="note" value="' + esc(c.note) + '" style="min-width:90px"></td>' +
          '<td class="ccell">' + (c.contracted === "계약"
            ? '<button class="btn tiny contractbtn" title="계약 작업 착수 정보">📄 계약내용' + (hasContractData(c) ? " ✓" : "") + '</button>'
            : '<span style="color:var(--muted);font-size:11px">-</span>') + '</td>' +
          '<td><button class="rowdel" title="삭제">✕</button></td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
    }
    host.appendChild(wrap);

    // 페이지 이동 바 (100건 초과 시)
    if (total > CUST_PAGE_SIZE) {
      var from = start + 1, to = Math.min(start + CUST_PAGE_SIZE, total);
      var pager = el("div", { class: "pager" });
      pager.innerHTML =
        '<button class="btn ghost tiny" id="pgFirst"' + (pg <= 1 ? " disabled" : "") + '>« 처음</button>' +
        '<button class="btn ghost tiny" id="pgPrev"' + (pg <= 1 ? " disabled" : "") + '>‹ 이전</button>' +
        '<span class="pginfo">' + from.toLocaleString("ko-KR") + '–' + to.toLocaleString("ko-KR") + ' / 총 ' + total.toLocaleString("ko-KR") + '건 · ' +
        '<b>' + pg + '</b> / ' + pages + '페이지</span>' +
        '<input type="number" id="pgJump" min="1" max="' + pages + '" value="' + pg + '" style="width:64px">' +
        '<button class="btn ghost tiny" id="pgGo">이동</button>' +
        '<button class="btn ghost tiny" id="pgNext"' + (pg >= pages ? " disabled" : "") + '>다음 ›</button>' +
        '<button class="btn ghost tiny" id="pgLast"' + (pg >= pages ? " disabled" : "") + '>끝 »</button>';
      host.appendChild(pager);
      var goPage = function (p) { p = Math.max(1, Math.min(pages, p || 1)); custPage[workspace] = p; renderCustomers(); host.scrollIntoView ? window.scrollTo(0, 0) : 0; };
      $("pgFirst").onclick = function () { goPage(1); };
      $("pgPrev").onclick = function () { goPage(pg - 1); };
      $("pgNext").onclick = function () { goPage(pg + 1); };
      $("pgLast").onclick = function () { goPage(pages); };
      $("pgGo").onclick = function () { goPage(parseInt($("pgJump").value, 10)); };
      $("pgJump").onkeydown = function (e) { if (e.key === "Enter") goPage(parseInt(this.value, 10)); };
    }

    // 이벤트
    $("fYear").onchange = function () { cf().year = this.value; resetCustPage(); renderCustomers(); };
    $("fMonth").onchange = function () { cf().month = this.value; resetCustPage(); renderCustomers(); };
    $("fContract").onchange = function () { cf().contract = this.value; resetCustPage(); renderCustomers(); };
    $("fQ").oninput = function () { cf().q = this.value; };
    $("fQ").onkeydown = function (e) { if (e.key === "Enter") { resetCustPage(); renderCustomers(); } };
    $("fQ").onblur = function () { resetCustPage(); renderCustomers(); };
    $("addRow").onclick = addCustomer;
    $("tplCust").onclick = function () { downloadTemplate("customers"); };
    $("fileCust").onchange = function () { handleUpload(this, "customers"); };

    var selAllCb = $("selAll");
    if (selAllCb) selAllCb.onchange = function () {
      var on = this.checked;
      pageBoxes().forEach(function (b) { b.checked = on; applyBox(b); });
      refreshSelUI();
    };
    $("selClear").onclick = function () {
      clearSel();
      pageBoxes().forEach(function (b) { b.checked = false; b.parentNode.parentNode.classList.remove("selrow"); });
      refreshSelUI();
    };
    $("selAllFiltered").onclick = function () {
      var m = selMap();
      filteredCustomers().forEach(function (c) { m[c.id] = true; });
      pageBoxes().forEach(function (b) { b.checked = true; b.parentNode.parentNode.classList.add("selrow"); });
      refreshSelUI();
    };
    $("delSel").onclick = function () {
      var ids = selIds();
      if (!ids.length) return;
      if (!confirm(ids.length.toLocaleString("ko-KR") + "건의 문의를 삭제할까요?\n\n(상단 “저장하기”를 눌러야 최종 반영됩니다)")) return;
      deleteCustomers(ids);
      markDirty();
      renderCustomers();
    };
    refreshSelUI();

    wrap.querySelectorAll("tbody tr").forEach(function (tr) {
      var id = Number(tr.getAttribute("data-id"));
      tr.querySelectorAll("[data-f]").forEach(function (inp) {
        var f = inp.getAttribute("data-f");
        var ev = (inp.tagName === "SELECT") ? "change" : "input";
        inp.addEventListener(ev, function () {
          var c = findCust(id); if (!c) return;
          c[f] = (f === "amount") ? (Number(inp.value) || 0) : inp.value;
          markDirty();
          if (f === "contracted" || f === "amount") refreshCustStats();
        });
      });
      var cbtn = tr.querySelector(".contractbtn");
      if (cbtn) cbtn.onclick = function () { openContract(id); };
      var addInp = tr.querySelector("[data-imgadd]");
      if (addInp) addInp.addEventListener("change", function () { handleImgAdd(id, this); });
      tr.querySelectorAll("[data-imgdel]").forEach(function (b) {
        b.addEventListener("click", function () {
          var c = findCust(id); if (!c || !c.images) return;
          c.images.splice(Number(b.getAttribute("data-imgdel")), 1);
          markDirty(); renderCustomers();
        });
      });
      var scb = tr.querySelector(".rowsel");
      if (scb) scb.addEventListener("change", function () { applyBox(this); refreshSelUI(); });
      tr.querySelector(".rowdel").onclick = function () {
        var c = findCust(id);
        var nm = (c && c.company) ? c.company : "선택한";
        if (!confirm('“' + nm + '” 문의를 삭제할까요?\n\n(상단 “저장하기”를 눌러야 최종 반영됩니다)')) return;
        deleteCustomers([id]);
        markDirty(); renderCustomers();
      };
    });
  }

  // ---------- 문의 선택(체크박스) ----------
  function pageBoxes() {
    return Array.prototype.slice.call(document.querySelectorAll("#tab-customers tbody .rowsel"));
  }
  function applyBox(box) {
    var tr = box.parentNode.parentNode;
    var id = Number(tr.getAttribute("data-id"));
    if (box.checked) selMap()[id] = true; else delete selMap()[id];
    tr.classList.toggle("selrow", box.checked);
  }
  function refreshSelUI() {
    var bar = $("selBar"); if (!bar) return;
    var ids = selIds();
    var total = filteredCustomers().length;
    $("selCnt").textContent = ids.length.toLocaleString("ko-KR");
    bar.classList.toggle("hidden", ids.length === 0);
    $("delSel").disabled = ids.length === 0;

    // 현재 페이지 밖에도 대상이 남아있으면 "필터된 전체 선택"을 제안
    var allBtn = $("selAllFiltered");
    var canAll = ids.length > 0 && total > ids.length && total > CUST_PAGE_SIZE;
    allBtn.classList.toggle("hidden", !canAll);
    if (canAll) allBtn.textContent = "조건에 맞는 전체 " + total.toLocaleString("ko-KR") + "건 선택";

    var cb = $("selAll");
    if (cb) {
      var boxes = pageBoxes();
      var on = boxes.filter(function (b) { return b.checked; }).length;
      cb.checked = boxes.length > 0 && on === boxes.length;
      cb.indeterminate = on > 0 && on < boxes.length;
    }
  }

  // ---------- 문의 첨부 이미지 ----------
  function imgStripHtml(c) {
    var imgs = c.images || [];
    var thumbs = imgs.map(function (src, idx) {
      return '<span class="thumb"><a href="' + esc(src) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(src) + '" alt="첨부 이미지"></a>' +
        '<button class="thumbdel" data-imgdel="' + idx + '" title="이미지 삭제">✕</button></span>';
    }).join("");
    return '<div class="imgstrip">' + thumbs +
      '<label class="imgadd" title="이미지 첨부">＋<input type="file" accept="image/*" multiple data-imgadd style="display:none"></label></div>';
  }

  function uploadImage(file, cb) {
    // 정적 모드: 서버 저장소가 없으므로 data.json 안에 base64로 담는다
    if (STATIC) { fileToDataUrl(file, 3, cb); return; }
    fetch("/api/upload", {
      method: "POST",
      headers: { "X-Admin-Token": TOKEN, "X-File-Name": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
      body: file
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j.ok) cb(null, res.j.file);
        else cb(new Error(res.j.error || ("업로드 실패 (" + res.status + ")")));
      })
      .catch(function () { cb(new Error("업로드 중 오류가 발생했습니다.")); });
  }

  function handleImgAdd(id, input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    if (!files.length) return;
    var c = findCust(id); if (!c) return;
    c.images = c.images || [];
    var busy = input.parentNode; if (busy) busy.classList.add("busy");
    var remaining = files.length, anyErr = null;
    files.forEach(function (f) {
      if (!/^image\//.test(f.type) && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)) {
        anyErr = f.name + ": 이미지 파일이 아닙니다."; if (--remaining === 0) finishImg(anyErr); return;
      }
      if (f.size > 10 * 1024 * 1024) {
        anyErr = f.name + ": 10MB를 초과합니다."; if (--remaining === 0) finishImg(anyErr); return;
      }
      uploadImage(f, function (err, src) {
        if (err) anyErr = err.message; else { c.images.push(src); markDirty(); }
        if (--remaining === 0) finishImg(anyErr);
      });
    });
  }
  function finishImg(err) {
    if (curTab === "customers") renderCustomers();
    if (err) alert("일부 이미지를 올리지 못했습니다.\n" + err);
  }

  // ---------- 계약내용(작업 착수 정보) ----------
  var contractId = null;

  function ensureContract(c) {
    if (!c.contract) {
      c.contract = { sales: "", party: "", completeDate: "", designer: "",
        quoteFiles: [], workFiles: [], contractFiles: [], workContent: "", companyInfo: "", contractDate: "" };
    }
    var ct = c.contract;
    ct.quoteFiles = ct.quoteFiles || [];
    ct.workFiles = ct.workFiles || [];
    ct.contractFiles = ct.contractFiles || [];
    // 비어 있을 때만 고객정보에서 기본값 채움
    if (!ct.contractDate) ct.contractDate = c.date || "";
    if (!ct.companyInfo) ct.companyInfo = [c.company, c.manager, c.contact, c.email].filter(Boolean).join(" / ");
    return ct;
  }
  function hasContractData(c) {
    var ct = c.contract; if (!ct) return false;
    if (ct.sales || ct.party || ct.completeDate || ct.designer || ct.workContent) return true;
    return ((ct.quoteFiles || []).length + (ct.workFiles || []).length + (ct.contractFiles || []).length) > 0;
  }
  function fileIcon(name) {
    var e = String(name || "").toLowerCase().split(".").pop();
    if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].indexOf(e) >= 0) return "🖼";
    if (e === "pdf") return "📕";
    if (["xls", "xlsx", "xlsm", "csv"].indexOf(e) >= 0) return "📊";
    if (["ppt", "pptx"].indexOf(e) >= 0) return "📈";
    if (["zip"].indexOf(e) >= 0) return "🗜";
    if (["ai", "psd", "eps"].indexOf(e) >= 0) return "🎨";
    return "📄";
  }
  function cField(num, label, inner, full) {
    return '<div class="field' + (full ? " full" : "") + '"><label><span class="num">' + num + '</span>' + esc(label) + '</label>' + inner + '</div>';
  }
  function fileBlock(key, files) {
    files = files || [];
    var items = files.map(function (f, i) {
      return '<div class="fileitem"><span class="ic">' + fileIcon(f.name) + '</span>' +
        '<a href="' + esc(f.file) + '" target="_blank" rel="noopener" download="' + esc(f.name) + '">' + esc(f.name) + '</a>' +
        '<button class="fdel" data-fdel="' + key + ':' + i + '" title="삭제">✕</button></div>';
    }).join("");
    return '<div class="filelist" data-fllist="' + key + '">' + items +
      '<label class="btn ghost tiny fileadd" data-fladd="' + key + '">＋ 파일 첨부<input type="file" multiple style="display:none"></label></div>';
  }

  function openContract(id) {
    var c = findCust(id); if (!c) return;
    ensureContract(c);
    contractId = id;
    $("cmWho").textContent = (c.company || "(업체명 미입력)") + " · " + ws().catLabel + ": " + (c[ws().catField] || "-");
    renderContractBody(c);
    $("contractModal").classList.remove("hidden");
  }

  function renderContractBody(c) {
    var ct = ensureContract(c);
    var body = $("cmBody");
    body.innerHTML =
      '<div class="fgrid">' +
        cField("1", "영업자", '<input type="text" data-cf="sales" value="' + esc(ct.sales) + '" placeholder="예: 홍길동">') +
        cField("2", "계약주체", '<input type="text" data-cf="party" value="' + esc(ct.party) + '" placeholder="계약 명의(회사/개인)">') +
        cField("3", "완료일", '<input type="date" data-cf="completeDate" value="' + esc(ct.completeDate) + '">') +
        cField("4", "담당 디자이너", '<input type="text" data-cf="designer" value="' + esc(ct.designer) + '" placeholder="배정 디자이너">') +
        cField("5", "견적서 (파일첨부)", fileBlock("quoteFiles", ct.quoteFiles), true) +
        cField("6", "작업자료 (파일첨부)", fileBlock("workFiles", ct.workFiles), true) +
        cField("7", "계약서 (파일첨부)", fileBlock("contractFiles", ct.contractFiles), true) +
        cField("8", "작업내용", '<textarea data-cf="workContent" placeholder="디자이너가 참고할 작업 요청/범위/유의사항">' + esc(ct.workContent) + '</textarea>', true) +
        cField("9", "업체 정보", '<textarea data-cf="companyInfo" placeholder="업체명 / 담당자 / 연락처 / 이메일 등">' + esc(ct.companyInfo) + '</textarea>', true) +
        cField("10", "계약일", '<input type="date" data-cf="contractDate" value="' + esc(ct.contractDate) + '">') +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px">' +
        '<button class="btn ghost" id="cmCloseBtn">닫기</button>' +
        '<button class="btn" id="cmSaveBtn">저장하기</button>' +
      '</div>';

    body.querySelectorAll("[data-cf]").forEach(function (inp) {
      inp.addEventListener("input", function () {
        var cc = findCust(contractId); if (!cc) return; ensureContract(cc);
        cc.contract[inp.getAttribute("data-cf")] = inp.value; markDirty();
      });
    });
    body.querySelectorAll("[data-fladd]").forEach(function (lbl) {
      var key = lbl.getAttribute("data-fladd");
      var inp = lbl.querySelector("input");
      if (inp) inp.addEventListener("change", function () { handleFileAdd(contractId, key, this); });
    });
    body.querySelectorAll("[data-fdel]").forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.getAttribute("data-fdel").split(":"); var key = parts[0], idx = Number(parts[1]);
        var cc = findCust(contractId); if (!cc || !cc.contract) return;
        cc.contract[key].splice(idx, 1); markDirty(); renderContractBody(cc);
      });
    });
    $("cmCloseBtn").onclick = closeContract;
    $("cmSaveBtn").onclick = function () { save(); };
  }

  function uploadFile(file, cb) {
    if (STATIC) {
      fileToDataUrl(file, 5, function (err, url) {
        if (err) cb(err); else cb(null, { file: url, name: file.name });
      });
      return;
    }
    fetch("/api/upload-file", {
      method: "POST",
      headers: { "X-Admin-Token": TOKEN, "X-File-Name": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
      body: file
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.j.ok) cb(null, { file: res.j.file, name: res.j.name });
        else cb(new Error(res.j.error || ("업로드 실패 (" + res.status + ")")));
      })
      .catch(function () { cb(new Error("업로드 중 오류가 발생했습니다.")); });
  }
  function handleFileAdd(id, key, input) {
    var files = Array.prototype.slice.call(input.files || []);
    input.value = "";
    if (!files.length) return;
    var c = findCust(id); if (!c) return; ensureContract(c);
    var lbl = input.parentNode; if (lbl) lbl.classList.add("busy");
    var remaining = files.length, anyErr = null;
    files.forEach(function (f) {
      if (f.size > 50 * 1024 * 1024) { anyErr = f.name + ": 50MB를 초과합니다."; if (--remaining === 0) finishFile(anyErr); return; }
      uploadFile(f, function (err, res) {
        if (err) anyErr = err.message; else { c.contract[key].push({ name: res.name, file: res.file }); markDirty(); }
        if (--remaining === 0) finishFile(anyErr);
      });
    });
  }
  function finishFile(err) {
    var c = findCust(contractId); if (c) renderContractBody(c);
    if (err) alert("일부 파일을 올리지 못했습니다.\n" + err);
  }
  function closeContract() {
    $("contractModal").classList.add("hidden");
    contractId = null;
    if (curTab === "customers") renderCustomers();
  }

  function refreshCustStats() {
    // 통계 카드만 다시 그리기 위해 전체 재렌더 (간단·안전)
    if (curTab === "customers") renderCustomers();
  }
  function findCust(id) { var L = curList(); for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i]; return null; }
  function customerYears() {
    var set = {};
    curList().forEach(function (c) { var y = String(c.date).slice(0, 4); if (/^\d{4}$/.test(y)) set[y] = 1; });
    return Object.keys(set).sort(function (a, b) { return b - a; });
  }

  function addCustomer() {
    var cfg = ws(), f = cf();
    var catVal = (f.cat !== "__all") ? f.cat : (cfg.cats[0] || "");
    // 연도/월 필터가 걸려 있으면 새 행이 필터에 걸려 사라지지 않도록 날짜를 맞춤
    var d = today();
    if (f.year !== "__all" || f.month !== "__all") {
      var now = new Date();
      var y = (f.year !== "__all") ? f.year : String(now.getFullYear());
      var m = (f.month !== "__all") ? f.month : String(now.getMonth() + 1);
      d = y + "-" + String(m).padStart(2, "0") + "-01";
    }
    var newContract = (f.contract !== "__all") ? f.contract : "미계약";
    var row = {
      id: DATA[cfg.nextIdKey]++, date: d, company: "", manager: "",
      contact: "", email: "", inquiry: "", channel: "홈페이지", contracted: newContract, amount: 0, note: "", images: []
    };
    row[cfg.catField] = catVal;
    curList().unshift(row);
    resetCustPage();
    markDirty(); renderCustomers();
    var first = $("tab-customers").querySelector('tbody tr input[data-f="company"]');
    if (first) first.focus();
  }

  // ===== 문의·매출 통계 =====
  function renderStats() {
    var host = $("tab-stats");
    host.innerHTML = "";

    var cfg = ws(), catField = cfg.catField;
    host.appendChild(el("div", { class: "infobar" },
      "<b>" + esc(cfg.noun) + "</b>의 문의·매출 통계입니다. <b>‘문의·계약 관리’ 시트</b>의 데이터로 자동 집계됩니다. 이전 문의를 한 번에 올리려면 <b>문의·계약 관리 탭 → ⬇ 양식</b>을 받아 작성한 뒤 <b>⬆ 엑셀 불러오기</b>로 업로드하세요. 업로드 즉시 아래 통계에 반영됩니다."));

    var dated = curList().filter(function (c) { return c.date; });

    // 연도별 집계 (전체 문의 기준, 계약/매출은 부가 지표)
    var byYear = {}; // year -> {inq, contract, sum, months:{1..12:{inq,contract,sum}}, prog:{}}
    dated.forEach(function (c) {
      var y = String(c.date).slice(0, 4);
      var m = parseInt(String(c.date).slice(5, 7), 10) || 0;
      var isC = c.contracted === "계약";
      var amt = Number(c.amount) || 0;
      if (!byYear[y]) { byYear[y] = { inq: 0, contract: 0, sum: 0, months: {}, prog: {} }; }
      byYear[y].inq++;
      if (isC) { byYear[y].contract++; byYear[y].sum += amt; byYear[y].prog[c[catField]] = (byYear[y].prog[c[catField]] || 0) + amt; }
      if (m) {
        var mo = byYear[y].months[m] = byYear[y].months[m] || { inq: 0, contract: 0, sum: 0 };
        mo.inq++;
        if (isC) { mo.contract++; mo.sum += amt; }
      }
    });
    var years = Object.keys(byYear).sort();
    var sy = statsYears[workspace];
    if (!sy || years.indexOf(sy) < 0) { sy = years.length ? years[years.length - 1] : null; statsYears[workspace] = sy; }

    // 총 요약
    var totalInq = dated.length;
    var totalContract = dated.filter(function (c) { return c.contracted === "계약"; }).length;
    var totalSum = dated.reduce(function (s, c) { return s + (c.contracted === "계약" ? (Number(c.amount) || 0) : 0); }, 0);
    var stats = el("div", { class: "stats" });
    stats.innerHTML =
      '<div class="stat total"><div class="n">' + totalInq + '</div><div class="l">총 문의</div></div>' +
      '<div class="stat done"><div class="n">' + totalContract + '</div><div class="l">총 계약</div></div>' +
      '<div class="stat sales"><div class="n">' + won(totalSum) + '</div><div class="l">총 계약 매출</div></div>' +
      '<div class="stat total"><div class="n">' + years.length + '</div><div class="l">집계 연도 수</div></div>';
    host.appendChild(stats);

    if (!dated.length) {
      host.appendChild(el("div", { class: "card" }, '<div class="empty">날짜가 입력된 문의가 없어 통계를 표시할 수 없습니다.</div>'));
      return;
    }

    var grid = el("div", { class: "yeargrid" });

    // 연도별 합계 표
    var yc = el("div", { class: "yearcol card" });
    var yhtml = '<h2>연도별 문의·계약</h2><table class="sum"><thead><tr><th>연도</th><th class="r">문의</th><th class="r">계약</th><th class="r">매출 합계</th></tr></thead><tbody>';
    years.forEach(function (y) {
      yhtml += '<tr class="yrow" data-y="' + y + '" style="cursor:pointer;' + (y === sy ? "background:#f2fbfb;" : "") + '">' +
        '<td><b>' + y + '</b></td><td class="r">' + byYear[y].inq + '건</td><td class="r">' + byYear[y].contract + '건</td><td class="r">' + won(byYear[y].sum) + '</td></tr>';
    });
    yhtml += '<tr class="tot"><td>합계</td><td class="r">' + totalInq + '건</td><td class="r">' + totalContract + '건</td><td class="r">' + won(totalSum) + '</td></tr>';
    yhtml += '</tbody></table><div style="font-size:11.5px;color:var(--muted);margin-top:8px">연도 행을 클릭하면 오른쪽에 해당 연도의 월별 문의 내역이 표시됩니다.</div>';
    yc.innerHTML = yhtml;
    grid.appendChild(yc);

    // 선택 연도 월별 표
    var mc = el("div", { class: "yearcol card" });
    var yd = byYear[sy];
    var maxM = 0; for (var mm = 1; mm <= 12; mm++) { if (yd.months[mm] && yd.months[mm].inq > maxM) maxM = yd.months[mm].inq; }
    var mhtml = '<h2>' + sy + '년 월별 문의 <span style="font-weight:500;color:var(--muted);font-size:12px">(문의 ' + yd.inq + '건 · 계약 ' + yd.contract + '건)</span></h2>' +
      '<table class="sum"><thead><tr><th>월</th><th class="r">문의</th><th class="r">계약</th><th class="r">매출 합계</th><th>문의 비중</th></tr></thead><tbody>';
    for (var m2 = 1; m2 <= 12; m2++) {
      var d = yd.months[m2] || { inq: 0, contract: 0, sum: 0 };
      var w = maxM ? Math.round(d.inq / maxM * 100) : 0;
      mhtml += '<tr><td>' + m2 + '월</td><td class="r">' + (d.inq || "-") + '</td><td class="r">' + (d.contract || "-") + '</td><td class="r">' + (d.sum ? won(d.sum) : "-") + '</td>' +
        '<td><div class="mbar"><i style="width:' + w + '%"></i></div></td></tr>';
    }
    mhtml += '<tr class="tot"><td>' + sy + '년 합계</td><td class="r">' + yd.inq + '건</td><td class="r">' + yd.contract + '건</td><td class="r">' + won(yd.sum) + '</td><td></td></tr>';
    mhtml += '</tbody></table>';
    // 분류(지원사업/고객분류)별 계약 매출
    var progKeys = Object.keys(yd.prog).sort(function (a, b) { return yd.prog[b] - yd.prog[a]; });
    if (progKeys.length) {
      mhtml += '<div style="margin-top:14px"><h2 style="margin-bottom:8px">' + sy + '년 ' + esc(cfg.catLabel) + '별 계약 매출</h2><table class="sum"><tbody>';
      progKeys.forEach(function (p) {
        mhtml += '<tr><td>' + esc(p) + '</td><td class="r">' + won(yd.prog[p]) + '</td></tr>';
      });
      mhtml += '</tbody></table></div>';
    }
    mc.innerHTML = mhtml;
    grid.appendChild(mc);

    host.appendChild(grid);

    host.querySelectorAll(".yrow").forEach(function (r) {
      r.onclick = function () { statsYears[workspace] = this.getAttribute("data-y"); renderStats(); };
    });
  }

  // ===== 공고 알림 대상 =====
  function noticeYears() {
    var set = {};
    DATA.notices.forEach(function (n) { var y = String(n.date).slice(0, 4); if (/^\d{4}$/.test(y)) set[y] = 1; });
    return Object.keys(set).sort(function (a, b) { return b - a; });
  }
  function filteredNotices() {
    return DATA.notices.filter(function (n) {
      if (nFilter.program !== "__all" && (n.programs || []).indexOf(nFilter.program) < 0) return false;
      if (nFilter.year !== "__all" && String(n.date).slice(0, 4) !== nFilter.year) return false;
      if (nFilter.month !== "__all" && String(parseInt(String(n.date).slice(5, 7), 10) || 0) !== nFilter.month) return false;
      return true;
    });
  }

  function renderNotices() {
    var host = $("tab-notices");
    host.innerHTML = "";

    host.appendChild(el("div", { class: "infobar" },
      "정부지원사업 <b>공고가 나왔을 때 단체 안내</b>할 고객 명단입니다. 등록일 기준 연도·월, 관심 지원사업으로 대상을 나눠 보고, 아래 “이메일 전체 복사”로 현재 목록의 이메일을 한번에 복사할 수 있습니다."));

    var rows = filteredNotices();
    var progFilterOpts = '<option value="__all">전체 관심사업</option>' + programs().map(function (p) { return '<option value="' + esc(p) + '"' + (nFilter.program === p ? " selected" : "") + ">" + esc(p) + " 관심</option>"; }).join("");
    var yearsList = noticeYears();
    var yearOpts = '<option value="__all">전체 연도</option>' + yearsList.map(function (y) { return '<option value="' + y + '"' + (nFilter.year === y ? " selected" : "") + ">" + y + "년</option>"; }).join("");
    var monthOpts = '<option value="__all">전체 월</option>';
    for (var mi = 1; mi <= 12; mi++) { monthOpts += '<option value="' + mi + '"' + (nFilter.month === String(mi) ? " selected" : "") + ">" + mi + "월</option>"; }
    var scope =
      (nFilter.year === "__all" ? "전체 연도" : nFilter.year + "년") +
      (nFilter.month === "__all" ? "" : " " + nFilter.month + "월");

    var tb = el("div", { class: "toolbar" });
    tb.innerHTML =
      '<select id="nYear">' + yearOpts + '</select>' +
      '<select id="nMonth">' + monthOpts + '</select>' +
      '<select id="nFilter">' + progFilterOpts + '</select>' +
      '<button class="btn ghost tiny" id="copyEmails">✉ 이메일 전체 복사</button>' +
      '<span id="copyMsg" class="msg ok" style="font-size:12.5px"></span>' +
      '<span class="sp"></span>' +
      '<span style="font-size:12.5px;color:var(--muted)">' + esc(scope) + ' · ' + rows.length + '곳</span>' +
      '<button class="btn ghost tiny" id="tplNotice">⬇ 양식</button>' +
      '<label class="btn ghost tiny" for="fileNotice" style="cursor:pointer">⬆ 엑셀 불러오기</label>' +
      '<input type="file" id="fileNotice" accept=".xlsx,.xls" style="display:none">' +
      '<button class="btn tiny" id="addNotice">+ 대상 추가</button>';
    host.appendChild(tb);

    var wrap = el("div", { class: "tablewrap" });
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty">조건에 맞는 알림 대상이 없습니다. “+ 대상 추가”로 등록하세요.</div>';
    } else {
      var table = el("table");
      table.innerHTML = "<thead><tr><th>번호</th><th>등록일</th><th>업체명</th><th>담당자</th><th>연락처</th><th>이메일</th><th>관심 지원사업</th><th>비고</th><th></th></tr></thead>";
      var tbody = el("tbody");
      rows.forEach(function (n, i) {
        n.programs = n.programs || [];
        var tr = el("tr"); tr.setAttribute("data-id", n.id);
        var chks = programs().map(function (p) {
          var on = n.programs.indexOf(p) >= 0;
          return '<label class="chk"><input type="checkbox" data-p="' + esc(p) + '"' + (on ? " checked" : "") + ">" + esc(p) + "</label>";
        }).join("");
        tr.innerHTML =
          '<td class="no">' + (i + 1) + '</td>' +
          '<td class="date"><input type="date" data-f="date" value="' + esc(n.date) + '"></td>' +
          '<td><input type="text" data-f="company" value="' + esc(n.company) + '" style="min-width:130px"></td>' +
          '<td><input type="text" data-f="manager" value="' + esc(n.manager) + '" style="min-width:70px"></td>' +
          '<td><input type="text" data-f="contact" value="' + esc(n.contact) + '" style="min-width:120px"></td>' +
          '<td><input type="email" data-f="email" value="' + esc(n.email) + '" style="min-width:160px"></td>' +
          '<td><div class="chkgroup">' + chks + '</div></td>' +
          '<td><input type="text" data-f="note" value="' + esc(n.note) + '" style="min-width:110px"></td>' +
          '<td><button class="rowdel" title="삭제">✕</button></td>';
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
    }
    host.appendChild(wrap);

    $("nYear").onchange = function () { nFilter.year = this.value; renderNotices(); };
    $("nMonth").onchange = function () { nFilter.month = this.value; renderNotices(); };
    $("nFilter").onchange = function () { nFilter.program = this.value; renderNotices(); };
    $("tplNotice").onclick = function () { downloadTemplate("notices"); };
    $("fileNotice").onchange = function () { handleUpload(this, "notices"); };
    $("addNotice").onclick = function () {
      var now = new Date();
      var y = (nFilter.year !== "__all") ? nFilter.year : String(now.getFullYear());
      var m = (nFilter.month !== "__all") ? nFilter.month : String(now.getMonth() + 1);
      var d = (nFilter.year !== "__all" || nFilter.month !== "__all") ? (y + "-" + String(m).padStart(2, "0") + "-01") : today();
      var progs = (nFilter.program !== "__all") ? [nFilter.program] : [];
      DATA.notices.push({ id: DATA.nextNoticeId++, date: d, company: "", manager: "", contact: "", email: "", programs: progs, note: "" });
      markDirty(); renderNotices();
      var last = host.querySelectorAll('tbody tr input[data-f="company"]');
      if (last.length) last[last.length - 1].focus();
    };
    $("copyEmails").onclick = function () {
      var list = filteredNotices().map(function (n) { return (n.email || "").trim(); }).filter(Boolean);
      var uniq = list.filter(function (v, i) { return list.indexOf(v) === i; });
      var text = uniq.join(", ");
      var msg = $("copyMsg");
      if (!uniq.length) { msg.className = "msg err"; msg.textContent = "이메일이 없습니다."; return; }
      var done = function () { msg.className = "msg ok"; msg.textContent = uniq.length + "개 이메일 복사됨"; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      } else { fallbackCopy(text); done(); }
    };

    wrap.querySelectorAll("tbody tr").forEach(function (tr) {
      var id = Number(tr.getAttribute("data-id"));
      tr.querySelectorAll("[data-f]").forEach(function (inp) {
        inp.addEventListener("input", function () { var n = findNotice(id); if (n) { n[inp.getAttribute("data-f")] = inp.value; markDirty(); } });
      });
      tr.querySelectorAll('input[data-p]').forEach(function (cb) {
        cb.addEventListener("change", function () {
          var n = findNotice(id); if (!n) return; n.programs = n.programs || [];
          var p = cb.getAttribute("data-p");
          if (cb.checked) { if (n.programs.indexOf(p) < 0) n.programs.push(p); }
          else { n.programs = n.programs.filter(function (x) { return x !== p; }); }
          markDirty();
        });
      });
      tr.querySelector(".rowdel").onclick = function () {
        DATA.notices = DATA.notices.filter(function (x) { return x.id !== id; });
        markDirty(); renderNotices();
      };
    });
  }
  function findNotice(id) { for (var i = 0; i < DATA.notices.length; i++) if (DATA.notices[i].id === id) return DATA.notices[i]; return null; }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta);
  }

  // ---------- 엑셀 대량 등록 ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function normHeader(s) { return String(s == null ? "" : s).toLowerCase().replace(/[()（）\s]/g, "").trim(); }
  function rowVal(row, keys) {
    for (var k in row) {
      var nk = normHeader(k);
      for (var i = 0; i < keys.length; i++) { if (nk === keys[i]) return row[k]; }
    }
    return "";
  }
  function toDateStr(v) {
    if (v == null || v === "") return "";
    if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + pad2(v.getMonth() + 1) + "-" + pad2(v.getDate());
    if (typeof v === "number" && window.XLSX && XLSX.SSF) {
      var d = XLSX.SSF.parse_date_code(v);
      if (d && d.y) return d.y + "-" + pad2(d.m) + "-" + pad2(d.d);
    }
    var s = String(v).trim().replace(/[.\/]/g, "-").replace(/\s+/g, "");
    var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]);
    return String(v).trim();
  }
  function parseAmount(v) {
    if (typeof v === "number") return Math.round(v);
    var s = String(v == null ? "" : v).replace(/[^0-9.\-]/g, "");
    return Math.round(Number(s) || 0);
  }
  function mapProgram(v) {
    v = String(v == null ? "" : v).trim(); var ps = programs();
    for (var i = 0; i < ps.length; i++) if (ps[i] === v) return ps[i];
    for (i = 0; i < ps.length; i++) if (v && (ps[i].indexOf(v) >= 0 || v.indexOf(ps[i]) >= 0)) return ps[i];
    return "기타정부사업";
  }
  function mapCategoryValue(v) {
    // 현재 워크스페이스에 맞게 분류 매핑 (gov=지원사업, gen=기고객/신규고객)
    // 시트에 분류값이 없으면 현재 선택된 하위 탭 분류를 기본값으로 사용
    var active = cf().cat;
    if (workspace === "gen") {
      v = String(v == null ? "" : v).trim();
      if (v.indexOf("신규") >= 0) return "신규고객";
      if (v.indexOf("기") >= 0) return "기고객";
      if (active !== "__all") return active;
      return "신규고객";
    }
    v = String(v == null ? "" : v).trim();
    if (!v && active !== "__all") return active;
    return mapProgram(v);
  }
  function mapChannel(v) {
    v = String(v == null ? "" : v).trim(); if (!v) return "홈페이지";
    for (var i = 0; i < CHANNELS.length; i++) if (CHANNELS[i] === v) return CHANNELS[i];
    if (v.indexOf("카톡") >= 0 || v.indexOf("카카오") >= 0) return "카카오톡";
    if (v.indexOf("채널") >= 0) return "채널톡";
    if (v.indexOf("메일") >= 0) return "이메일";
    if (v.indexOf("전화") >= 0 || v.indexOf("유선") >= 0) return "전화";
    if (v.indexOf("홈페이지") >= 0 || v.indexOf("웹") >= 0) return "홈페이지";
    if (v.indexOf("소개") >= 0 || v.indexOf("지인") >= 0) return "소개";
    return "기타";
  }
  function mapContract(v) {
    v = String(v == null ? "" : v).trim();
    if (v.indexOf("진행") >= 0) return "진행중";
    if (v.indexOf("미") >= 0) return "미계약";
    if (v.indexOf("계약") >= 0) return "계약";
    return "미계약";
  }
  function parseProgList(v) {
    if (!v) return [];
    var parts = String(v).split(/[,/·|;、\n]+/); var ps = programs(); var out = [];
    parts.forEach(function (x) {
      x = x.trim(); if (!x) return;
      for (var i = 0; i < ps.length; i++) {
        if (ps[i] === x || ps[i].indexOf(x) >= 0 || x.indexOf(ps[i]) >= 0) { if (out.indexOf(ps[i]) < 0) out.push(ps[i]); }
      }
    });
    return out;
  }
  function rowHasData(r) { for (var k in r) { if (String(r[k] == null ? "" : r[k]).trim() !== "") return true; } return false; }

  var CUST_KEYS = {
    date: ["날짜", "일자", "문의날짜", "문의일"],
    cat: ["지원사업", "지원사업종류", "사업", "사업명", "분류", "고객분류", "구분", "고객구분"],
    company: ["업체명", "회사명", "업체", "고객사"],
    manager: ["담당자", "담당", "이름", "성명"],
    contact: ["연락처", "전화", "전화번호", "휴대폰", "핸드폰", "핸드폰번호"],
    email: ["이메일", "email", "메일", "이메일주소"],
    inquiry: ["문의내용", "문의", "내용", "문의사항"],
    channel: ["문의경로", "경로", "유입경로"],
    contracted: ["계약여부", "계약", "계약상태", "상태"],
    amount: ["견적금액", "금액", "견적", "계약금액", "견적가"],
    note: ["비고", "메모", "특이사항", "기타"]
  };
  var NOTICE_KEYS = {
    date: ["등록일", "날짜", "일자", "등록날짜"],
    company: ["업체명", "회사명", "업체", "고객사"],
    manager: ["담당자", "담당", "이름", "성명"],
    contact: ["연락처", "전화", "전화번호", "휴대폰", "핸드폰"],
    email: ["이메일", "email", "메일", "이메일주소"],
    programs: ["관심지원사업", "관심사업", "지원사업", "관심"],
    note: ["비고", "메모", "특이사항", "기타"]
  };

  function importCustomers(rows) {
    var cfg = ws(), n = 0;
    rows.forEach(function (r) {
      if (!rowHasData(r)) return;
      var row = {
        id: DATA[cfg.nextIdKey]++,
        date: toDateStr(rowVal(r, CUST_KEYS.date)),
        company: String(rowVal(r, CUST_KEYS.company) || "").trim(),
        manager: String(rowVal(r, CUST_KEYS.manager) || "").trim(),
        contact: String(rowVal(r, CUST_KEYS.contact) || "").trim(),
        email: String(rowVal(r, CUST_KEYS.email) || "").trim(),
        inquiry: String(rowVal(r, CUST_KEYS.inquiry) || "").trim(),
        channel: mapChannel(rowVal(r, CUST_KEYS.channel)),
        contracted: mapContract(rowVal(r, CUST_KEYS.contracted)),
        amount: parseAmount(rowVal(r, CUST_KEYS.amount)),
        note: String(rowVal(r, CUST_KEYS.note) || "").trim(),
        images: []
      };
      row[cfg.catField] = mapCategoryValue(rowVal(r, CUST_KEYS.cat));
      curList().push(row);
      n++;
    });
    return n;
  }
  function importNotices(rows) {
    var n = 0;
    rows.forEach(function (r) {
      if (!rowHasData(r)) return;
      DATA.notices.push({
        id: DATA.nextNoticeId++,
        date: toDateStr(rowVal(r, NOTICE_KEYS.date)),
        company: String(rowVal(r, NOTICE_KEYS.company) || "").trim(),
        manager: String(rowVal(r, NOTICE_KEYS.manager) || "").trim(),
        contact: String(rowVal(r, NOTICE_KEYS.contact) || "").trim(),
        email: String(rowVal(r, NOTICE_KEYS.email) || "").trim(),
        programs: parseProgList(rowVal(r, NOTICE_KEYS.programs)),
        note: String(rowVal(r, NOTICE_KEYS.note) || "").trim()
      });
      n++;
    });
    return n;
  }

  function readXlsx(file, cb) {
    if (!window.XLSX) { cb(new Error("엑셀 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.")); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array", cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        cb(null, XLSX.utils.sheet_to_json(ws, { defval: "", raw: true }));
      } catch (err) { cb(err); }
    };
    reader.onerror = function () { cb(new Error("파일을 읽을 수 없습니다.")); };
    reader.readAsArrayBuffer(file);
  }
  function handleUpload(input, kind) {
    var f = input.files && input.files[0]; if (!f) return;
    readXlsx(f, function (err, rows) {
      input.value = "";
      if (err) { alert("엑셀을 읽을 수 없습니다.\n" + err.message); return; }
      if (!rows || !rows.length) { alert("데이터 행이 없습니다. 첫 행은 머리글이어야 합니다."); return; }
      var label = (kind === "customers") ? "문의" : "알림 대상";
      if (!confirm(rows.length + "개 행을 현재 " + label + " 목록에 추가합니다. 진행할까요?")) return;
      var n = (kind === "customers") ? importCustomers(rows) : importNotices(rows);
      markDirty();
      if (kind === "customers") renderCustomers(); else renderNotices();
      alert(n + "건을 추가했습니다.\n내용을 확인한 뒤 상단 ‘저장하기’로 저장하세요.");
    });
  }
  function downloadTemplate(kind) {
    if (!window.XLSX) { alert("엑셀 라이브러리를 불러오지 못했습니다."); return; }
    var aoa, name, sheet, cols;
    if (kind === "customers") {
      if (workspace === "gen") {
        aoa = [
          ["날짜", "분류", "업체명", "담당자", "연락처", "이메일", "문의내용", "문의경로", "계약여부", "견적금액", "비고"],
          ["2026-04-10", "기고객", "(예시)한빛상사", "최부장", "010-7777-8888", "gen1@example.com", "홈페이지 리뉴얼 견적 문의", "전화", "계약", 2000000, "기존 거래처"],
          ["2026-06-02", "신규고객", "(예시)블루오션", "정대리", "010-9999-0000", "gen2@example.com", "로고·명함 디자인 문의", "홈페이지", "진행중", 500000, ""]
        ];
        cols = [12, 10, 20, 10, 15, 22, 30, 10, 10, 12, 16];
        name = "일반고객_문의계약_대량등록양식.xlsx"; sheet = "일반고객";
      } else {
        aoa = [
          ["날짜", "지원사업", "업체명", "담당자", "연락처", "이메일", "문의내용", "문의경로", "계약여부", "견적금액", "비고"],
          ["2026-02-11", "수출바우처", "(예시)대영에스에프", "김대표", "010-1234-5678", "sample@example.com", "수출바우처 자부담 및 지원한도 문의", "홈페이지", "계약", 5000000, "3월 착수"],
          ["2026-03-05", "혁신바우처", "(예시)준성테크", "이과장", "010-2222-3333", "sample2@example.com", "마케팅 컨설팅 견적 요청", "전화", "진행중", 3000000, "선정 결과 대기"]
        ];
        cols = [12, 14, 20, 10, 15, 22, 30, 10, 10, 12, 16];
        name = "정부지원사업_문의계약_대량등록양식.xlsx"; sheet = "문의계약";
      }
    } else {
      aoa = [
        ["등록일", "업체명", "담당자", "연락처", "이메일", "관심지원사업", "비고"],
        ["2026-01-15", "(예시)대영에스에프", "김대표", "010-1234-5678", "sample@example.com", "수출바우처, 혁신바우처", "매년 수출바우처 관심"],
        ["2026-02-20", "(예시)준성테크", "이과장", "010-2222-3333", "sample2@example.com", "혁신바우처, 소공인판로개척지원사업", ""]
      ];
      cols = [12, 20, 10, 15, 22, 28, 20];
      name = "정부지원사업_공고알림대상_대량등록양식.xlsx"; sheet = "공고알림대상";
    }
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = cols.map(function (w) { return { wch: w }; });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheet);
    XLSX.writeFile(wb, name);
  }

  // ===================================================================
  // ===== 홈페이지 유지보수 (유지보수 관리센터 병합) =====
  // ===================================================================
  function pageFile(it) {
    var p = it.path ? String(it.path).split(".")[0].split("[")[0] : "";
    if (p && PAGE_MAP[p]) return PAGE_MAP[p];
    if (it.menu && MENU_PAGE[it.menu]) return MENU_PAGE[it.menu];
    return null;
  }
  function pageInfo(co, it) {
    var pg = pageFile(it);
    if (!pg) return null;
    var isTest = !!(co && co.previewBase);
    var base = String((co && (co.previewBase || co.site)) || "").replace(/\/+$/, "");
    var url = base ? base + "/" + pg : null;
    if (url && it.path) url += "?edit=" + encodeURIComponent(it.path);
    return { url: url, label: PAGE_LABEL[pg] || pg, isTest: isTest };
  }
  function mntCompany() {
    if (!DATA || !DATA.companies) return null;
    for (var i = 0; i < DATA.companies.length; i++) if (DATA.companies[i].id === mntSelId) return DATA.companies[i];
    return null;
  }
  function workStats(co) {
    var total = co.items.length, work = 0, done = 0, doing = 0, hold = 0;
    for (var i = 0; i < co.items.length; i++) {
      var it = co.items[i];
      var isWork = (it.request && it.request.trim() !== "") || (it.status && it.status !== "");
      if (isWork) work++;
      if (it.status === "완료") done++;
      else if (it.status === "요청" || it.status === "확인중") doing++;
      else if (it.status === "보류") hold++;
    }
    var pct = work ? Math.round(done / work * 100) : 0;
    return { total: total, work: work, done: done, doing: doing, hold: hold, pct: pct };
  }

  function renderMaint() {
    var host = $("tab-maint");
    host.innerHTML =
      '<div class="mnt-layout">' +
        '<nav id="mnt-side">' +
          '<div class="navtitle">관리 업체</div>' +
          '<div id="mnt-coList"></div>' +
          '<button class="btn ghost" id="mnt-addCoBtn" style="width:100%;margin-top:6px;">+ 업체 추가</button>' +
        '</nav>' +
        '<main id="mnt-panel">' +
          '<div id="mnt-panelBody"></div>' +
          '<div class="empty" id="mnt-emptyState">왼쪽에서 업체를 선택하거나 새 업체를 추가하세요.</div>' +
        '</main>' +
      '</div>';
    $("mnt-addCoBtn").onclick = addMntCompany;
    renderMntCompanies();
    renderMntPanel();
  }

  function renderMntCompanies() {
    var host = $("mnt-coList"); if (!host) return; host.innerHTML = "";
    var totalItems = 0;
    DATA.companies.forEach(function (co) {
      totalItems += co.items.length;
      var s = workStats(co);
      var b = el("button", { "class": "co" + (co.id === mntSelId ? " active" : ""), "data-id": co.id });
      b.innerHTML =
        '<div class="nm">' + esc(co.name || "(이름 없음)") + '</div>' +
        '<div class="mini">항목 ' + s.total + ' · 작업 ' + s.work + '건</div>' +
        '<div class="bar"><i style="width:' + s.pct + '%"></i></div>' +
        '<div class="pct">완료 ' + s.done + ' / ' + s.work + ' (' + s.pct + '%)</div>';
      b.addEventListener("click", function () { if (mntSelId !== co.id) { mntSelId = co.id; renderMntCompanies(); renderMntPanel(); } });
      host.appendChild(b);
    });
    $("whoCount").textContent = "관리 업체 " + DATA.companies.length + "곳 · 전체 항목 " + totalItems;
  }

  function renderMntPanel() {
    var co = mntCompany();
    var body = $("mnt-panelBody"); if (!body) return;
    if (!co) { body.innerHTML = ""; $("mnt-emptyState").classList.remove("hidden"); return; }
    $("mnt-emptyState").classList.add("hidden");
    body.innerHTML = "";

    // --- 업체 정보 카드 ---
    var info = el("div", { "class": "card" });
    var head = el("div", { "class": "co-head" });
    head.innerHTML = '<h1>' + esc(co.name) + '</h1><span class="sp"></span>';
    var openSite = el("button", { "class": "btn ghost tiny" }, "홈페이지 ↗");
    openSite.addEventListener("click", function () { if (co.site) window.open(co.site, "_blank"); });
    var openAdmin = el("button", { "class": "btn ghost tiny" }, "관리자 ↗");
    openAdmin.addEventListener("click", function () { if (co.admin) window.open(co.admin, "_blank"); });
    var delCo = el("button", { "class": "btn danger tiny" }, "업체 삭제");
    delCo.addEventListener("click", function () {
      if (!confirm('"' + co.name + '" 업체를 삭제할까요? (저장 시 반영)')) return;
      DATA.companies = DATA.companies.filter(function (c) { return c.id !== co.id; });
      mntSelId = DATA.companies.length ? DATA.companies[0].id : null;
      markDirty(); renderMntCompanies(); renderMntPanel();
    });
    head.appendChild(openSite); head.appendChild(openAdmin); head.appendChild(delCo);
    info.appendChild(head);

    var grid = el("div", { "class": "meta-grid", style: "margin-top:14px" });
    var fields = [
      ["name", "업체명"], ["site", "홈페이지 URL"], ["admin", "관리자 URL"],
      ["manager", "담당자"], ["contact", "연락처"], ["email", "이메일"]
    ];
    fields.forEach(function (f) {
      var wrap = el("div");
      wrap.appendChild(el("label", null, esc(f[1])));
      var inp = el("input", { type: "text", value: "" });
      inp.value = co[f[0]] || "";
      inp.addEventListener("input", function () { co[f[0]] = inp.value; markDirty(); if (f[0] === "name") renderMntCompanies(); });
      wrap.appendChild(inp);
      grid.appendChild(wrap);
    });
    info.appendChild(grid);
    var noteWrap = el("div", { style: "margin-top:12px" });
    noteWrap.appendChild(el("label", { style: "display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:5px" }, "비고"));
    var note = el("textarea", { style: "min-height:44px" });
    note.value = co.note || "";
    note.addEventListener("input", function () { co.note = note.value; markDirty(); });
    noteWrap.appendChild(note);
    info.appendChild(noteWrap);
    body.appendChild(info);

    // --- 통계 카드 ---
    var s = workStats(co);
    var stats = el("div", { "class": "card" });
    stats.innerHTML =
      '<div class="stats">' +
      '<div class="stat total"><div class="n">' + s.total + '</div><div class="l">전체 항목</div></div>' +
      '<div class="stat req"><div class="n">' + s.work + '</div><div class="l">작업 대상</div></div>' +
      '<div class="stat doing"><div class="n">' + s.doing + '</div><div class="l">진행중(요청+확인중)</div></div>' +
      '<div class="stat done"><div class="n">' + s.done + '</div><div class="l">완료</div></div>' +
      '</div>' +
      '<div class="bigbar"><i style="width:' + s.pct + '%"></i></div>' +
      '<div class="hint" style="margin-top:6px">완료율 ' + s.pct + '%' + (s.hold ? ' · 보류 ' + s.hold + '건' : '') + '</div>';
    body.appendChild(stats);

    // --- 툴바 + 테이블 카드 ---
    var tcard = el("div", { "class": "card" });
    tcard.appendChild(buildMntToolbar(co));
    var tw = el("div", { "class": "tablewrap" });
    tw.appendChild(buildMntTable(co));
    tcard.appendChild(tw);
    body.appendChild(tcard);
  }

  function buildMntToolbar(co) {
    var bar = el("div", { "class": "toolbar" });

    var mSel = el("select");
    mSel.appendChild(el("option", { value: "" }, "메뉴: 전체"));
    MENUS.forEach(function (m) { var o = el("option", { value: m }, esc(m)); if (mntFilter.menu === m) o.selected = true; mSel.appendChild(o); });
    mSel.addEventListener("change", function () { mntFilter.menu = mSel.value; refreshMntTable(co); });
    bar.appendChild(mSel);

    var sSel = el("select");
    sSel.appendChild(el("option", { value: "__all" }, "상태: 전체"));
    STATUS.forEach(function (st) { var o = el("option", { value: st.v }, esc(st.label)); if (mntFilter.status === st.v) o.selected = true; sSel.appendChild(o); });
    sSel.addEventListener("change", function () { mntFilter.status = sSel.value; refreshMntTable(co); });
    bar.appendChild(sSel);

    var q = el("input", { type: "text", placeholder: "검색(위치·내용·요청)" });
    q.value = mntFilter.q;
    var qt;
    q.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { mntFilter.q = q.value; refreshMntTable(co); }, 180); });
    bar.appendChild(q);

    var chk = el("label", { "class": "chk" });
    var cb = el("input", { type: "checkbox" }); cb.checked = mntFilter.onlyReq;
    cb.addEventListener("change", function () { mntFilter.onlyReq = cb.checked; refreshMntTable(co); });
    chk.appendChild(cb); chk.appendChild(document.createTextNode("요청 있는 항목만"));
    bar.appendChild(chk);

    var reqCount = co.items.filter(function (x) { return (x.status || "") === "요청"; }).length;
    var reqActive = mntFilter.status === "요청";
    var reqOnly = el("button", { id: "mntReqOnlyBtn", "class": "btn tiny" + (reqActive ? "" : " ghost") },
      (reqActive ? "↩ 전체 보기" : "🔔 요청만 보기") + " (" + reqCount + ")");
    reqOnly.addEventListener("click", function () {
      mntFilter.status = reqActive ? "__all" : "요청";
      renderMntPanel();
    });
    bar.appendChild(reqOnly);

    bar.appendChild(el("span", { "class": "sp" }));

    var dl = el("button", { id: "mntDlReqBtn", "class": "btn tiny", title: "'요청' 상태 항목만 모아 엑셀(.xlsx) 수정요청서로 저장 (Claude 전달용)" },
      "📄 요청 수정요청서 다운로드" + (reqCount ? " (" + reqCount + ")" : ""));
    if (!reqCount) dl.disabled = true;
    dl.addEventListener("click", function () { exportRequestSheet(co); });
    bar.appendChild(dl);

    var imp = el("label", { "class": "btn ghost tiny", style: "position:relative;overflow:hidden;cursor:pointer" });
    imp.appendChild(document.createTextNode("📥 수정요청서(xlsx) 불러오기"));
    var file = el("input", { type: "file", accept: ".xlsx,.xls", style: "position:absolute;inset:0;opacity:0;cursor:pointer" });
    file.addEventListener("change", function () { if (file.files[0]) importMntXlsx(co, file.files[0]); file.value = ""; });
    imp.appendChild(file);
    bar.appendChild(imp);

    var add = el("button", { "class": "btn tiny" }, "+ 행 추가");
    add.addEventListener("click", function () {
      co.items.unshift({ id: (co.nextId = (co.nextId || co.items.length + 1)), menu: "", location: "", current: "", request: "", status: "요청", remark: "", path: "" });
      co.nextId++;
      markDirty(); renderMntPanel();
    });
    bar.appendChild(add);

    return bar;
  }

  function filteredItems(co) {
    var q = mntFilter.q.trim().toLowerCase();
    return co.items.filter(function (it) {
      if (mntFilter.menu && it.menu !== mntFilter.menu) return false;
      if (mntFilter.status !== "__all" && (it.status || "") !== mntFilter.status) return false;
      if (mntFilter.onlyReq && !(it.request && it.request.trim())) return false;
      if (q) {
        var hay = ((it.location || "") + " " + (it.current || "") + " " + (it.request || "") + " " + (it.remark || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function buildMntTable(co) {
    var table = el("table");
    table.innerHTML =
      '<thead><tr>' +
      '<th style="width:44px">번호</th>' +
      '<th style="width:96px">메뉴</th>' +
      '<th style="width:210px">위치 / 항목</th>' +
      '<th>현재 내용</th>' +
      '<th style="width:240px">수정 요청 내용</th>' +
      '<th style="width:104px">상태</th>' +
      '<th style="width:150px">비고</th>' +
      '<th style="width:34px"></th>' +
      '</tr></thead>';
    var tb = el("tbody");
    var list = filteredItems(co);
    if (!list.length) {
      tb.appendChild(el("tr", null, '<td colspan="8" class="empty">표시할 항목이 없습니다. 필터를 바꾸거나 "수정요청서 불러오기"로 데이터를 추가하세요.</td>'));
    } else {
      list.forEach(function (it, idx) {
        var tr = el("tr", { "data-id": it.id });
        var imgtag = it.isImage ? '<div class="imgtag">🖼 이미지 파일</div>' : '';
        var stOpts = STATUS.map(function (st) { return '<option value="' + st.v + '"' + ((it.status || "") === st.v ? " selected" : "") + '>' + esc(st.label) + '</option>'; }).join("");
        var pi = pageInfo(co, it);
        var locLink = pi
          ? (pi.url
              ? '<a class="pagelink' + (pi.isTest ? ' pagelink--test' : '') + '" href="' + esc(pi.url) + '" target="_blank" rel="noopener" title="' + esc(pi.url) + '">🔗 ' + esc(pi.label) + ' 페이지에서 보기 ↗' + (pi.isTest ? ' <b>TEST</b>' : '') + '</a>'
              : '<span class="nolink">📄 ' + esc(pi.label) + ' 페이지 (업체 홈페이지 URL 없음)</span>')
          : '';
        tr.innerHTML =
          '<td>' + (idx + 1) + '</td>' +
          '<td class="menu"><span class="tag">' + esc(it.menu || "-") + '</span></td>' +
          '<td class="loc"><div class="loctxt">' + esc(it.location) + '</div>' + locLink + '</td>' +
          '<td class="cur">' + esc(it.current) + imgtag + '</td>' +
          '<td><textarea class="req" data-f="request" rows="1">' + esc(it.request) + '</textarea>' + attachHtml(it) + '</td>' +
          '<td><div class="st-wrap"><span class="dot ' + statusCls(it.status || "") + '"></span>' +
          '<select class="st" data-f="status">' + stOpts + '</select></div></td>' +
          '<td><textarea class="rmk" data-f="remark" rows="1">' + esc(it.remark) + '</textarea></td>' +
          '<td><button class="rowdel" title="행 삭제">×</button></td>';
        tb.appendChild(tr);
      });
    }
    tb.addEventListener("input", function (e) {
      var t = e.target; if (t.tagName !== "TEXTAREA") return;
      var tr = t.closest("tr"); var it = findItem(co, tr.getAttribute("data-id"));
      if (it) { it[t.getAttribute("data-f")] = t.value; markDirty(); }
    });
    tb.addEventListener("change", function (e) {
      var t = e.target;
      if (t.classList.contains("attachfile")) {
        var trF = t.closest("tr"); var itF = findItem(co, trF.getAttribute("data-id"));
        var f = t.files && t.files[0];
        if (!itF || !f) return;
        if (f.size > 5 * 1024 * 1024) { alert("첨부 파일은 5MB 이하만 가능합니다.\n(" + Math.round(f.size / 1024 / 1024 * 10) / 10 + "MB)"); t.value = ""; return; }
        var fr = new FileReader();
        fr.onload = function () {
          itF.attachment = { name: f.name, type: f.type || "", size: f.size, dataUrl: String(fr.result) };
          markDirty();
          var box = trF.querySelector(".attach");
          if (box) box.outerHTML = attachHtml(itF);
        };
        fr.readAsDataURL(f);
        return;
      }
      if (!t.classList.contains("st")) return;
      var tr = t.closest("tr"); var it = findItem(co, tr.getAttribute("data-id"));
      if (it) {
        it.status = t.value; markDirty();
        var dot = tr.querySelector(".dot"); dot.className = "dot " + statusCls(t.value);
        updateMntStats(co);
        refreshReqUI(co);
      }
    });
    tb.addEventListener("click", function (e) {
      if (e.target.classList.contains("adel")) {
        var trA = e.target.closest("tr"); var itA = findItem(co, trA.getAttribute("data-id"));
        if (itA && itA.attachment) {
          delete itA.attachment; markDirty();
          var box = trA.querySelector(".attach"); if (box) box.outerHTML = attachHtml(itA);
        }
        return;
      }
      if (!e.target.classList.contains("rowdel")) return;
      var tr = e.target.closest("tr"); var id = tr.getAttribute("data-id");
      if (!confirm("이 행을 삭제할까요? (저장 시 반영)")) return;
      co.items = co.items.filter(function (x) { return String(x.id) !== String(id); });
      markDirty(); renderMntPanel();
    });
    table.appendChild(tb);
    return table;
  }

  function findItem(co, id) { for (var i = 0; i < co.items.length; i++) if (String(co.items[i].id) === String(id)) return co.items[i]; return null; }

  function refreshMntTable(co) {
    var wrap = $("tab-maint").querySelector(".tablewrap");
    if (!wrap) return;
    wrap.innerHTML = ""; wrap.appendChild(buildMntTable(co));
  }
  function updateMntStats(co) { renderMntPanelStats(co); renderMntCompanies(); }
  function renderMntPanelStats(co) {
    var s = workStats(co);
    var statCard = $("tab-maint").querySelectorAll(".card")[1];
    if (!statCard) return;
    var ns = statCard.querySelectorAll(".stat .n");
    if (ns.length >= 4) { ns[0].textContent = s.total; ns[1].textContent = s.work; ns[2].textContent = s.doing; ns[3].textContent = s.done; }
    var bar = statCard.querySelector(".bigbar > i"); if (bar) bar.style.width = s.pct + "%";
    var hint = statCard.querySelector(".hint"); if (hint) hint.textContent = "완료율 " + s.pct + "%" + (s.hold ? " · 보류 " + s.hold + "건" : "");
  }

  function addMntCompany() {
    var bg = el("div", { "class": "mnt-modal-bg" });
    var m = el("div", { "class": "mnt-modal" });
    m.innerHTML =
      '<h3>새 업체 추가</h3>' +
      '<div class="hint">먼저 업체 정보를 입력하고, 추가 후 "수정요청서(xlsx) 불러오기"로 항목을 채우면 됩니다.</div>' +
      '<label>업체명 *</label><input type="text" id="m_name" placeholder="예) ㈜대영에스에프">' +
      '<label>홈페이지 URL</label><input type="text" id="m_site" placeholder="https://example.com">' +
      '<label>관리자 URL</label><input type="text" id="m_admin" placeholder="https://example.com/admin.html">' +
      '<label>담당자 / 연락처</label><input type="text" id="m_manager" placeholder="담당자">' +
      '<div class="row"><button class="btn ghost" id="m_cancel">취소</button><button class="btn" id="m_ok">추가</button></div>';
    bg.appendChild(m); document.body.appendChild(bg);
    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    $("m_cancel").addEventListener("click", close);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    $("m_ok").addEventListener("click", function () {
      var name = $("m_name").value.trim();
      if (!name) { $("m_name").focus(); return; }
      var co = {
        id: "co" + Date.now(), name: name,
        site: $("m_site").value.trim(), admin: $("m_admin").value.trim(),
        manager: $("m_manager").value.trim(), contact: "", email: "", note: "",
        createdAt: today(), nextId: 1, items: []
      };
      DATA.companies.push(co); mntSelId = co.id; close();
      markDirty(); renderMntCompanies(); renderMntPanel();
    });
    $("m_name").focus();
  }

  function importMntXlsx(co, fileObj) {
    if (typeof XLSX === "undefined") { alert("엑셀 라이브러리를 불러오지 못했습니다(인터넷 연결 필요)."); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
        var sheetName = wb.SheetNames.indexOf("수정요청") >= 0 ? "수정요청" : wb.SheetNames[0];
        var ws = wb.Sheets[sheetName];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
        var hIdx = -1, cmap = {};
        for (var r = 0; r < rows.length; r++) {
          if (rows[r].indexOf("관리자 메뉴") >= 0) { hIdx = r; break; }
        }
        if (hIdx < 0) { alert("'관리자 메뉴' 헤더를 찾을 수 없습니다. 준성테크 양식의 수정요청서인지 확인하세요."); return; }
        rows[hIdx].forEach(function (h, c) {
          var k = String(h).replace(/\s/g, "");
          if (k === "관리자메뉴") cmap.menu = c;
          else if (k === "위치/항목" || k === "위치항목") cmap.loc = c;
          else if (k === "현재내용") cmap.cur = c;
          else if (k === "수정요청내용") cmap.req = c;
          else if (k === "처리상태") cmap.st = c;
          else if (k === "비고") cmap.rmk = c;
          else if (k === "데이터경로") cmap.path = c;
        });
        var imported = [];
        for (var i = hIdx + 1; i < rows.length; i++) {
          var row = rows[i];
          var get = function (key) { return cmap[key] != null ? String(row[cmap[key]] || "").trim() : ""; };
          var menu = get("menu"), loc = get("loc"), cur = get("cur");
          var req = get("req"), st = get("st"), rmk = get("rmk"), path = get("path");
          if (menu === "예시" || (row[0] && String(row[0]).trim() === "예시")) continue;
          if (!menu && !loc && !cur && !req) continue;
          imported.push({
            id: 0, menu: menu, location: loc, current: cur,
            request: req, status: (st || ""), remark: rmk, path: path,
            isImage: /assets\/|\.png|\.jpg|\.jpeg|\.mp4|\.gif|\.webp/i.test(cur)
          });
        }
        if (!imported.length) { alert("불러올 데이터 행이 없습니다."); return; }
        var replace = true;
        if (co.items.length) {
          replace = confirm("불러온 " + imported.length + "개 항목으로 기존 " + co.items.length + "개를 교체할까요?\n\n[확인] 교체   /   [취소] 기존에 추가");
        }
        var next = co.nextId || (co.items.length + 1);
        imported.forEach(function (it) { it.id = next++; });
        co.nextId = next;
        if (replace) co.items = imported; else co.items = co.items.concat(imported);
        markDirty(); renderMntPanel(); renderMntCompanies();
        var m = $("saveMsg"); m.className = "msg ok"; m.textContent = "✔ " + imported.length + "개 항목을 불러왔습니다. (저장 필요)";
        setTimeout(markDirty, 30);
      } catch (err) {
        alert("파일을 읽는 중 오류가 발생했습니다: " + err.message);
      }
    };
    reader.readAsArrayBuffer(fileObj);
  }

  function refreshReqUI(co) {
    var reqCount = co.items.filter(function (x) { return (x.status || "") === "요청"; }).length;
    var rb = $("mntReqOnlyBtn");
    if (rb) {
      var active = mntFilter.status === "요청";
      rb.className = "btn tiny" + (active ? "" : " ghost");
      rb.textContent = (active ? "↩ 전체 보기" : "🔔 요청만 보기") + " (" + reqCount + ")";
    }
    var db = $("mntDlReqBtn");
    if (db) {
      db.disabled = !reqCount;
      db.textContent = "📄 요청 수정요청서 다운로드" + (reqCount ? " (" + reqCount + ")" : "");
    }
  }
  function attachHtml(it) {
    var a = it && it.attachment;
    if (a && a.dataUrl) {
      var kb = Math.round((a.size || 0) / 1024) || 1;
      var isImg = /^image\//.test(a.type || "") || /^data:image\//.test(a.dataUrl || "");
      var thumb = isImg
        ? '<img class="athumb" src="' + esc(a.dataUrl) + '" alt="">'
        : '<span class="afileicon">📄</span>';
      return '<div class="attach has">' + thumb +
        '<span class="aname" title="' + esc(a.name || "") + '">' + esc(a.name || "파일") + ' <em>' + kb + 'KB</em></span>' +
        '<label class="arep">교체<input type="file" class="attachfile" accept="image/*" hidden></label>' +
        '<button class="adel" title="첨부 삭제">✕</button></div>';
    }
    return '<div class="attach"><label class="abtn" title="로고·이미지 파일 첨부">📎 이미지/로고 첨부<input type="file" class="attachfile" accept="image/*" hidden></label></div>';
  }
  function triggerDownload(blob, fname) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 150);
  }
  function exportRequestSheet(co) {
    var items = co.items.filter(function (x) { return (x.status || "") === "요청"; });
    if (!items.length) {
      alert("'요청' 상태인 항목이 없습니다.\n\n고객이 수정 요청 내용을 입력하고 상태를 '요청'으로 바꾼 항목만 수정요청서에 담깁니다.");
      return;
    }
    if (typeof XLSX === "undefined") { alert("엑셀 라이브러리를 불러오지 못했습니다(인터넷 연결 필요)."); return; }

    var now = new Date();
    var stamp = now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
    var stampT = stamp + " " + pad2(now.getHours()) + ":" + pad2(now.getMinutes());
    var base = String(co.site || "").replace(/\/+$/, "");

    var attachList = [];
    var attachName = {};
    items.forEach(function (it, i) {
      if (it.attachment && it.attachment.dataUrl) {
        var safe = String(it.attachment.name || "image").replace(/[\\/:*?"<>|]/g, "_");
        var zn = pad2(i + 1) + "_" + safe;
        attachName[i] = zn;
        attachList.push({ name: zn, dataUrl: it.attachment.dataUrl });
      }
    });

    var head = ["번호", "관리자 메뉴", "위치/항목", "현재내용", "수정요청내용", "처리상태", "비고", "데이터경로", "유형", "첨부파일", "페이지 링크"];
    var aoa = [head];
    items.forEach(function (it, i) {
      var pg = pageFile(it);
      var link = (base && pg && it.path) ? base + "/" + pg + "?edit=" + encodeURIComponent(it.path) : "";
      var att = attachName[i] ? "images/" + attachName[i] : "";
      var reqText = it.request || (att ? "첨부 이미지 파일로 교체 (" + att + ")" : "");
      aoa.push([
        i + 1, it.menu || "", it.location || "", it.current || "", reqText,
        it.status || "요청", it.remark || "", it.path || "",
        it.isImage ? "이미지" : "텍스트", att, link
      ]);
    });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 5 }, { wch: 14 }, { wch: 26 }, { wch: 40 }, { wch: 40 },
      { wch: 9 }, { wch: 20 }, { wch: 30 }, { wch: 8 }, { wch: 22 }, { wch: 46 }
    ];

    var g = [
      ["홈페이지 수정요청서 — " + (co.name || "")],
      [""],
      ["■ Claude에게 (적용 지침)"],
      ["'수정요청' 시트의 각 행은 홈페이지 수정 요청 1건입니다."],
      ["각 행의 [데이터경로] 가 가리키는 content.json 값을 [현재내용] → [수정요청내용] 으로 바꿔 주세요."],
      ["경로는 사이트 루트 content.json 기준입니다. 예) products.categories[0].items[1].title"],
      ["[유형]=이미지 인 행은 텍스트가 아니라 이미지 파일 교체가 필요한 항목입니다."],
      ["[첨부파일] 에 파일명이 있으면 이 zip 안 images/ 폴더의 해당 이미지 파일로 교체하세요."],
      ["[페이지 링크] 를 열면 실제 홈페이지에서 해당 위치가 네모 박스로 표시됩니다."],
      [""],
      ["■ 업체 정보"],
      ["업체", co.name || ""],
      ["홈페이지", base ? base + "/" : ""],
      ["관리자 페이지", co.admin || ""],
      ["콘텐츠 파일", "content.json (사이트 루트)"],
      ["생성 일시", stampT],
      ["요청 항목 수", items.length + "건"],
      ["첨부 이미지 수", attachList.length + "개"]
    ];
    var ws2 = XLSX.utils.aoa_to_sheet(g);
    ws2["!cols"] = [{ wch: 16 }, { wch: 70 }];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "수정요청");
    XLSX.utils.book_append_sheet(wb, ws2, "안내");

    var safeName = (co.name || "업체").replace(/[\\/:*?"<>|]/g, "");
    var xlsxName = safeName + "_수정요청서_" + stamp + ".xlsx";
    var m = $("saveMsg");

    if (!attachList.length) {
      XLSX.writeFile(wb, xlsxName);
      m.className = "msg ok"; m.textContent = "✔ '요청' " + items.length + "건 수정요청서(.xlsx) 다운로드";
      return;
    }

    if (typeof JSZip === "undefined") {
      XLSX.writeFile(wb, xlsxName);
      attachList.forEach(function (a) {
        var mt = /^data:([^;]*);base64,(.*)$/.exec(a.dataUrl || "");
        if (!mt) return;
        var bin = atob(mt[2]); var arr = new Uint8Array(bin.length);
        for (var k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k);
        triggerDownload(new Blob([arr], { type: mt[1] || "application/octet-stream" }), a.name);
      });
      m.className = "msg ok"; m.textContent = "✔ 수정요청서(.xlsx) + 첨부 " + attachList.length + "개 다운로드 (개별)";
      return;
    }

    var wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    var zip = new JSZip();
    zip.file(xlsxName, wbout);
    var imgDir = zip.folder("images");
    attachList.forEach(function (a) {
      var mt = /^data:[^;]*;base64,(.*)$/.exec(a.dataUrl || "");
      if (mt) imgDir.file(a.name, mt[1], { base64: true });
    });
    m.className = "msg"; m.textContent = "수정요청서(zip) 생성 중…";
    zip.generateAsync({ type: "blob" }).then(function (blob) {
      triggerDownload(blob, safeName + "_수정요청서_" + stamp + ".zip");
      m.className = "msg ok"; m.textContent = "✔ '요청' " + items.length + "건 + 첨부 " + attachList.length + "개 수정요청서(zip) 다운로드";
    }).catch(function (err) {
      m.className = "msg err"; m.textContent = "zip 생성 실패: " + (err && err.message || err);
    });
  }

  // ---------- 초기화 ----------
  function init() {
    $("loginBtn").onclick = doLogin;
    $("pw").addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    $("logoutBtn").onclick = logout;
    $("saveBtn").onclick = save;
    $("reloadBtn").onclick = function () {
      if (dirty && !confirm("저장하지 않은 변경사항이 사라집니다. 되돌릴까요?")) return;
      loadData();
    };
    document.querySelectorAll(".tab").forEach(function (b) { b.onclick = function () { switchTab(b.getAttribute("data-tab")); }; });
    document.querySelectorAll(".wsbtn").forEach(function (b) { b.onclick = function () { switchWorkspace(b.getAttribute("data-ws")); }; });
    $("cmClose").onclick = closeContract;
    $("contractModal").addEventListener("click", function (e) { if (e.target === this) closeContract(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("contractModal").classList.contains("hidden")) closeContract(); });
    window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    probeServer(function (hasServer) {
      STATIC = !hasServer;
      if (!STATIC) { if (TOKEN) enterApp(); return; }
      $("logoutBtn").textContent = "파일 닫기";
      $("saveBtn").textContent = canFS ? "저장하기" : "💾 data.json 내려받기";
      $("reloadBtn").textContent = "되돌리기";
      setupStaticMode();
    });
  }
  init();
})();
