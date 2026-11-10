/* 幸运号码 · 前端交互
 * 桌面端通过 Tauri invoke 调用 Rust 侧的等概率抽样；
 * 浏览器直接打开时自动降级为本地 Web Crypto 抽样，方便预览界面。
 */

const RULES = {
  ssq: {
    name: "双色球",
    front: { max: 33, count: 6, label: "红球", chip: "red", ball: "red", dot: "dot-red", hot: "红球出现频次", text: "01–33 中选 6 个", odds: "33 选 6" },
    back: { max: 16, count: 1, label: "蓝球", chip: "blue", ball: "blue", dot: "dot-blue", hot: "蓝球出现频次", text: "01–16 中选 1 个", odds: "16 选 1" },
  },
  dlt: {
    name: "大乐透",
    front: { max: 35, count: 5, label: "前区", chip: "amber", ball: "amber", dot: "dot-amber", hot: "前区出现频次", text: "01–35 中选 5 个", odds: "35 选 5" },
    back: { max: 12, count: 2, label: "后区", chip: "violet", ball: "violet", dot: "dot-violet", hot: "后区出现频次", text: "01–12 中选 2 个", odds: "12 选 2" },
  },
};

const PER_ROUND = 5;
const $ = (id) => document.getElementById(id);

const state = {
  kind: "ssq",
  tickets: [],
  tally: { front: {}, back: {} },
  total: 0,
  busy: false,
  desktop: false,
};

const fmt = (n) => String(n).padStart(2, "0");

/* ---------- 数据来源 ---------- */
function localDraw(max, count) {
  const pool = Array.from({ length: max }, (_, i) => i + 1);
  const entropy = new Uint32Array(max);
  crypto.getRandomValues(entropy);
  for (let i = 0; i < count; i += 1) {
    const j = i + (entropy[i] % (max - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, count).sort((a, b) => a - b);
}

function localTickets(kind, count) {
  const rule = RULES[kind];
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    kind,
    front: localDraw(rule.front.max, rule.front.count),
    back: localDraw(rule.back.max, rule.back.count),
  }));
}

async function requestTickets(kind, count) {
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  if (invoke) {
    try {
      const result = await invoke("generate_tickets", { kind, count });
      state.desktop = true;
      return result;
    } catch (error) {
      showToast("桌面命令不可用，已切换为本地随机");
    }
  }
  state.desktop = false;
  return localTickets(kind, count);
}

function updateConnection() {
  const pill = $("connPill");
  if (state.desktop) {
    pill.classList.remove("preview");
    $("connText").textContent = "桌面端已连接 · 本地随机";
  } else {
    pill.classList.add("preview");
    $("connText").textContent = "本地随机模式 · 浏览器预览";
  }
}

/* ---------- 渲染 ---------- */
function ballHtml(num, zone, delay) {
  const rule = RULES[state.kind][zone];
  return `<span class="ball ${rule.ball}" data-value="${num}" data-max="${rule.max}" style="--delay:${delay}ms">${fmt(num)}</span>`;
}

function renderTickets(animate) {
  const list = $("ticketList");
  const rule = RULES[state.kind];

  if (state.tickets.length === 0) {
    list.innerHTML = `<div class="ticket-empty"><span>✦</span><div>号码尚未生成，点击「一键生成 ${PER_ROUND} 注」试试手气</div></div>`;
    return;
  }

  list.innerHTML = state.tickets
    .map((ticket, index) => {
      let delay = index * 85;
      const front = ticket.front
        .map((num) => {
          const html = ballHtml(num, "front", delay);
          delay += 38;
          return html;
        })
        .join("");
      const back = ticket.back
        .map((num) => {
          const html = ballHtml(num, "back", delay);
          delay += 38;
          return html;
        })
        .join("");
      return `
        <div class="ticket" style="--delay:${index * 85}ms">
          <span class="ticket-idx">${fmt(ticket.id)}</span>
          <div class="ball-group">${front}</div>
          <span class="zone-split"></span>
          <div class="ball-group">${back}</div>
          <button class="ticket-copy" data-index="${index}" title="复制这一注" aria-label="复制第 ${ticket.id} 注">⧉</button>
        </div>`;
    })
    .join("");

  if (animate) rollNumbers();
}

function rollNumbers() {
  const balls = Array.from(document.querySelectorAll(".ball[data-value]"));
  const frames = 7;
  let frame = 0;
  const timer = window.setInterval(() => {
    frame += 1;
    balls.forEach((ball) => {
      const max = Number(ball.dataset.max);
      ball.textContent = frame >= frames ? fmt(Number(ball.dataset.value)) : fmt(1 + Math.floor(Math.random() * max));
    });
    if (frame >= frames) window.clearInterval(timer);
  }, 56);
}

function renderRule() {
  const rule = RULES[state.kind];
  $("frontChip").textContent = rule.front.label;
  $("backChip").textContent = rule.back.label;
  $("frontChip").className = `rule-chip ${rule.front.chip}`;
  $("backChip").className = `rule-chip ${rule.back.chip}`;
  $("frontRule").textContent = rule.front.text;
  $("backRule").textContent = rule.back.text;
  $("frontRule").nextElementSibling.textContent = rule.front.odds;
  $("backRule").nextElementSibling.textContent = rule.back.odds;
  $("kindBadge").textContent = rule.name;
  $("hotFrontTitle").innerHTML = `<span class="hot-dot ${rule.front.dot}"></span> ${rule.front.hot}`;
  $("hotBackTitle").innerHTML = `<span class="hot-dot ${rule.back.dot}"></span> ${rule.back.hot}`;

  document.querySelectorAll(".seg-item").forEach((item) => {
    const active = item.dataset.kind === state.kind;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
  });
}

function renderHot() {
  [["front", "hotFront", 5], ["back", "hotBack", 3]].forEach(([zone, elementId, limit]) => {
    const entries = Object.entries(state.tally[zone])
      .map(([num, count]) => ({ num: Number(num), count }))
      .sort((a, b) => b.count - a.count || a.num - b.num)
      .slice(0, limit);
    const peak = entries.length ? entries[0].count : 1;
    const el = $(elementId);
    if (entries.length === 0) {
      el.innerHTML = `<div class="hot-placeholder">生成号码后显示统计</div>`;
      return;
    }
    el.innerHTML = entries
      .map(
        (item) => `
        <div class="hot-row">
          <span class="hot-num">${fmt(item.num)}</span>
          <span class="hot-bar ${zone}"><i style="width:${Math.max(12, (item.count / peak) * 100)}%"></i></span>
          <span class="hot-count">${item.count}</span>
        </div>`
      )
      .join("");
  });
}

function ticketText(ticket) {
  return `${ticket.front.map(fmt).join(" ")}  |  ${ticket.back.map(fmt).join(" ")}`;
}

/* ---------- 行为 ---------- */
function accumulate(tickets) {
  tickets.forEach((ticket) => {
    ticket.front.forEach((num) => {
      state.tally.front[num] = (state.tally.front[num] || 0) + 1;
    });
    ticket.back.forEach((num) => {
      state.tally.back[num] = (state.tally.back[num] || 0) + 1;
    });
  });
}

async function generate() {
  if (state.busy) return;
  state.busy = true;
  const btn = $("generateBtn");
  btn.classList.add("is-busy");
  try {
    const tickets = await requestTickets(state.kind, PER_ROUND);
    state.tickets = tickets;
    state.total += tickets.length;
    accumulate(tickets);
    $("totalCount").textContent = state.total;
    $("generatedAt").textContent = `生成于 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`;
    renderTickets(true);
    renderHot();
    updateConnection();
  } catch (error) {
    showToast(`生成失败：${error}`);
  } finally {
    btn.classList.remove("is-busy");
    state.busy = false;
  }
}

function switchKind(kind) {
  if (!RULES[kind]) return;
  state.kind = kind;
  state.tally = { front: {}, back: {} };
  renderRule();
  renderHot();
  generate();
}

function clearTickets() {
  state.tickets = [];
  $("generatedAt").textContent = "已清空 · 会话统计保留";
  renderTickets(false);
  showToast("注单已清空");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      /* 继续走兼容方案 */
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

let toastTimer = 0;
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 1900);
}

function bindEvents() {
  $("segment").addEventListener("click", (event) => {
    const item = event.target.closest(".seg-item");
    if (item) switchKind(item.dataset.kind);
  });

  $("generateBtn").addEventListener("click", generate);

  $("copyAllBtn").addEventListener("click", async () => {
    if (state.tickets.length === 0) {
      showToast("还没有可复制的号码");
      return;
    }
    const header = `${RULES[state.kind].name} · 模拟选号 ${state.tickets.length} 注\n`;
    const text = header + state.tickets.map((ticket, i) => `${fmt(i + 1)}. ${ticketText(ticket)}`).join("\n");
    showToast((await copyText(text)) ? `已复制 ${state.tickets.length} 注到剪贴板` : "复制失败，请手动选择");
  });

  $("clearBtn").addEventListener("click", clearTickets);

  $("ticketList").addEventListener("click", async (event) => {
    const button = event.target.closest(".ticket-copy");
    if (!button) return;
    const ticket = state.tickets[Number(button.dataset.index)];
    if (!ticket) return;
    showToast((await copyText(ticketText(ticket))) ? `第 ${fmt(ticket.id)} 注已复制` : "复制失败，请手动选择");
  });

  document.addEventListener("keydown", (event) => {
    const tag = event.target && event.target.tagName;
    if (tag === "BUTTON" || tag === "INPUT" || tag === "TEXTAREA") return;
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      generate();
    }
  });
}

function init() {
  bindEvents();
  renderRule();
  renderHot();
  updateConnection();
  generate();
}

init();
