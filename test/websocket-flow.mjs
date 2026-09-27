import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8788";
const socketBase = base.replace(/^http/, "ws");

async function call(data, token) {
  const response = await fetch(`${base}/api/room`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  return { status: response.status, ...(await response.json()) };
}

async function getState(room, token) {
  const response = await fetch(`${base}/api/room?room=${room}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, ...(await response.json()) };
}

function connect(room, token) {
  const ws = new WebSocket(`${socketBase}/api/room?room=${room}&token=${token}`);
  const inbox = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    inbox.push(message);
    for (const waiter of [...waiters]) waiter();
  });
  return {
    ws,
    opened: new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    }),
    async until(predicate) {
      const deadline = Date.now() + 5000;
      for (;;) {
        const index = inbox.findIndex((message) => message.type === "state" && predicate(message.state));
        if (index >= 0) return inbox.splice(0, index + 1).at(-1).state;
        if (Date.now() >= deadline) throw new Error("Timed out waiting for WebSocket state");
        await new Promise((resolve) => {
          const timer = setTimeout(() => { waiters.splice(waiters.indexOf(wake), 1); resolve(); }, 100);
          const wake = () => { clearTimeout(timer); waiters.splice(waiters.indexOf(wake), 1); resolve(); };
          waiters.push(wake);
        });
      }
    },
  };
}

const first = await call({ action: "create" });
assert.equal(first.status, 201);
const room = first.state.room;
const a = connect(room, first.token);
await a.opened;
await a.until((state) => state.seat === 0);

const second = await call({ action: "join", room });
assert.equal(second.status, 200);
const b = connect(room, second.token);
await b.opened;
const aPlaying = await a.until((state) => state.phase === "playing" && state.otherOnline);
const bPlaying = await b.until((state) => state.phase === "playing" && state.otherOnline);
assert.equal(aPlaying.hand.length, 5);
assert.equal(bPlaying.hand.length, 5);

const cardId = aPlaying.hand[0].id;
assert.equal((await call({ action: "play", room, cardId }, first.token)).status, 200);
assert.equal((await a.until((state) => state.selectedCardId === cardId)).myReady, true);
assert.equal((await b.until((state) => state.otherReady)).selectedCardId, null);

b.ws.close();
await a.until((state) => !state.otherOnline && state.canKick);
const rejoined = connect(room, second.token);
await rejoined.opened;
assert.equal((await rejoined.until((state) => state.otherOnline)).hand.length, 5);
await a.until((state) => state.otherOnline && !state.canKick);

rejoined.ws.close();
await a.until((state) => !state.otherOnline && state.canKick);
const kicked = await call({ action: "kick", room }, first.token);
assert.equal(kicked.status, 200);
assert.equal(kicked.state.phase, "waiting");
assert.equal(kicked.state.joined, 1);
assert.equal((await call({ action: "play", room, cardId }, second.token)).status, 403);
const third = await call({ action: "join", room });
assert.equal(third.status, 200);
assert.equal(third.state.phase, "playing");

assert.equal((await call({ action: "leave", room }, first.token)).left, true);
assert.equal((await getState(room, first.token)).status, 403);
a.ws.close();
console.log(`WebSocket reconnect, private selection, kick and leave passed in room ${room}.`);
