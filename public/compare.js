const $ = (id) => document.getElementById(id);
const suggested = (new URLSearchParams(location.search).get("room") || "").toUpperCase();
if (suggested) $("room-code").value = suggested;
let room = null;
let token = null;
let state = null;
let busy = false;
let socket = null;
let reconnectTimer = null;
let reconnectCount = 0;

const savedKey = (code) => `majiang:room:${code}`;

function notify(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}
const rank = (value) => ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[value] || String(value);

async function request(data, auth = token) {
  const response = await fetch("/api/room", {
    method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "网络出错了，请重试");
  return result;
}

async function fetchState() {
  const response = await fetch(`/api/room?room=${encodeURIComponent(room)}`, {
    headers: { authorization: `Bearer ${token}` }, cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "没能连上房间");
  return result.state;
}

function enter(data) {
  room = data.state.room;
  token = data.token;
  localStorage.setItem(savedKey(room), token);
  sessionStorage.removeItem(savedKey(room));
  history.replaceState(null, "", `/compare.html?room=${room}`);
  $("entry").hidden = true;
  $("game").hidden = false;
  notify("");
  render(data.state);
  connect();
}

function connection(text) { $("connection-status").textContent = text; }

function connect() {
  if (!room || !token) return;
  clearTimeout(reconnectTimer);
  if (socket) socket.close();
  const url = new URL("/api/room", location.href);
  url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("room", room);
  url.searchParams.set("token", token);
  const ws = new WebSocket(url);
  socket = ws;
  connection("正在连接…");
  ws.addEventListener("open", () => {
    if (socket !== ws) return;
    reconnectCount = 0;
    connection("已连接");
    notify("");
  });
  ws.addEventListener("message", (event) => {
    if (socket !== ws) return;
    try {
      const message = JSON.parse(event.data);
      if (message.type === "state" && message.state.room === room) render(message.state);
    } catch { /* Ignore malformed updates; reconnection fetches a fresh state. */ }
  });
  ws.addEventListener("close", () => {
    if (socket !== ws || !room) return;
    connection("连接断开，正在重连…");
    reconnectCount += 1;
    if (reconnectCount === 3) {
      fetchState().catch((error) => {
        if (/找不到|不在这个房间|过期/.test(error.message)) returnToEntry(error.message);
      });
    }
    reconnectTimer = setTimeout(connect, Math.min(1000 * 2 ** (reconnectCount - 1), 10000));
  });
}

function returnToEntry(message) {
  const oldRoom = room;
  room = null;
  token = null;
  state = null;
  clearTimeout(reconnectTimer);
  if (socket) { const old = socket; socket = null; old.close(); }
  if (oldRoom) {
    localStorage.removeItem(savedKey(oldRoom));
    sessionStorage.removeItem(savedKey(oldRoom));
    $("room-code").value = oldRoom;
  }
  $("game").hidden = true;
  $("entry").hidden = false;
  notify(message);
}

function cardElement(card, clickable) {
  const el = document.createElement(clickable ? "button" : "div");
  el.className = `card${"♥♦".includes(card.suit) ? " red" : ""}`;
  if (clickable) {
    el.type = "button";
    el.disabled = state.myReady;
    const selected = state.selectedCardId === card.id;
    if (selected) el.classList.add("selected");
    el.setAttribute("aria-label", `${card.suit}${rank(card.rank)}，${selected ? "本回合已出这张牌" : "出这张牌"}`);
    el.addEventListener("click", () => play(card.id));
  }
  for (let i = 0; i < 2; i++) {
    const text = document.createElement("span");
    text.textContent = `${rank(card.rank)}${card.suit}`;
    el.append(text);
  }
  if (clickable && state.selectedCardId === card.id) {
    const badge = document.createElement("b");
    badge.className = "selected-badge";
    badge.textContent = "已出";
    el.append(badge);
  }
  return el;
}

function renderReveal(current) {
  const target = $("reveal");
  target.replaceChildren();
  const reveal = current.lastReveal;
  if (!reveal) {
    target.textContent = current.phase === "waiting" ? "先坐下，等朋友来。" : "先选一张牌吧。";
    return;
  }
  const row = document.createElement("div");
  row.className = "reveal-row";
  for (const [seat, label] of [[current.seat, "你"], [1 - current.seat, "朋友"]]) {
    const side = document.createElement("div");
    side.className = "reveal-side";
    const name = document.createElement("label");
    name.textContent = label;
    side.append(name, cardElement(reveal.cards[seat], false));
    row.append(side);
  }
  const note = document.createElement("p");
  note.className = "reveal-note";
  const result = reveal.winner === null ? "同点数，这局算平" : reveal.winner === current.seat ? "这局你赢啦" : "这局朋友赢啦";
  note.textContent = `第 ${reveal.batch} 组 · 第 ${reveal.turn} 局：${result}${reveal.batchTied ? "。五局打平，已重新发牌加赛" : ""}`;
  target.append(row, note);
}

function render(next) {
  state = next;
  $("room-label").textContent = next.room;
  $("my-score").textContent = next.score[next.seat];
  $("other-score").textContent = next.score[1 - next.seat];
  $("round-label").textContent = next.phase === "waiting" ? "等朋友入座" : next.phase === "finished" ? (next.champion === next.seat ? "你赢啦！" : "朋友赢啦！") : `第 ${next.batch} 组${next.batch > 1 ? "加赛" : ""}`;
  $("turn-label").textContent = next.phase === "playing" ? `第 ${next.turn} / 5 局` : next.phase === "finished" ? `最终比分 ${next.score[next.seat]} : ${next.score[1 - next.seat]}` : "朋友进来就发牌";
  $("other-status").textContent = next.joined < 2 ? "对方还没入座" : !next.otherOnline ? "朋友暂时离线，可用原链接重进" : next.phase === "playing" ? (next.otherReady ? "朋友已经选好牌了" : "朋友还在选牌") : "朋友在线";
  $("kick-player").hidden = !next.canKick;
  const backs = $("other-cards");
  backs.replaceChildren();
  for (let i = 0; i < next.otherCount; i++) {
    const back = document.createElement("span");
    back.className = "back-card";
    backs.append(back);
  }
  renderReveal(next);
  const hand = $("hand");
  hand.replaceChildren();
  if (next.phase === "playing") next.hand.forEach((card) => hand.append(cardElement(card, true)));
  $("hand-title").textContent = next.phase === "playing" ? "你的牌" : next.phase === "finished" ? "这局结束啦" : "坐好等发牌";
  const selected = next.hand.find((card) => card.id === next.selectedCardId);
  $("hand-tip").textContent = next.phase === "playing" ? (selected ? `本回合已出 ${selected.suit}${rank(selected.rank)}，等朋友选好后一起翻开` : "选一张，等朋友也选好就一起翻开") : next.phase === "finished" ? "想再玩一局？两个人都点一下就重新发牌" : "把邀请链接发给朋友";
  $("finish-actions").hidden = next.phase !== "finished";
  $("rematch").disabled = next.myRematch;
  $("rematch-status").textContent = next.myRematch ? "等朋友也点再来一局" : next.otherRematch ? "朋友想再来一局" : "";
}

async function play(cardId) {
  if (busy || state.myReady) return;
  busy = true;
  try { const result = await request({ action: "play", room, cardId }); render(result.state); notify(""); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
}

$("create-room").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try { enter(await request({ action: "create" }, null)); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
});

$("join-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  try { enter(await request({ action: "join", room: $("room-code").value }, null)); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
});

$("copy-link").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/compare.html?room=${room}`); notify("邀请链接已复制，发给朋友就行"); }
  catch { notify(`房间号是 ${room}，也可以直接发给朋友`); }
});

$("rematch").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try { const result = await request({ action: "rematch", room }); render(result.state); notify(""); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
});

$("kick-player").addEventListener("click", async () => {
  if (busy || !state.canKick) return;
  if (!confirm("移出离线玩家会清空当前这局，确定吗？")) return;
  busy = true;
  try { const result = await request({ action: "kick", room }); render(result.state); notify("离线玩家已移出，可以把邀请链接发给朋友"); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
});

$("leave-room").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  try { await request({ action: "leave", room }); returnToEntry("已退出房间。房间无人在线后最多保留 10 分钟"); }
  catch (error) { notify(error.message); }
  finally { busy = false; }
});

if (/^[A-Z2-9]{8}$/.test(suggested)) {
  const saved = localStorage.getItem(savedKey(suggested)) || sessionStorage.getItem(savedKey(suggested));
  if (saved) {
    room = suggested;
    token = saved;
    fetchState().then((next) => enter({ token, state: next })).catch((error) => returnToEntry(error.message));
  }
}
