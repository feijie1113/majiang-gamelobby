import assert from "node:assert/strict";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8788";
async function call(data, token) {
  const response = await fetch(`${base}/api/room`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(data),
  });
  return { status: response.status, ...(await response.json()) };
}
async function state(room, token) {
  const response = await fetch(`${base}/api/room?room=${room}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, ...(await response.json()) };
}

const first = await call({ action: "create" });
assert.equal(first.status, 201);
const room = first.state.room;
assert.equal(first.state.phase, "waiting");
const second = await call({ action: "join", room });
assert.equal(second.status, 200);
assert.equal(second.state.phase, "playing");
assert.equal((await call({ action: "join", room })).status, 409);
assert.equal((await state(room, crypto.randomUUID())).status, 403);
let a = (await state(room, first.token)).state;
let b = (await state(room, second.token)).state;
assert.equal(a.hand.length, 5);
assert.equal(b.hand.length, 5);
assert.equal(new Set([...a.hand, ...b.hand].map((card) => card.id)).size, 10);

for (let turn = 0; turn < 100; turn++) {
  const cardA = a.hand[0].id;
  const cardB = b.hand[0].id;
  const playedA = await call({ action: "play", room, cardId: cardA }, first.token);
  assert.equal(playedA.status, 200);
  assert.equal(playedA.state.myReady, true);
  assert.equal(playedA.state.lastReveal?.turn || 0, a.lastReveal?.turn || 0);
  assert.equal((await call({ action: "play", room, cardId: a.hand[1]?.id || cardA }, first.token)).status, 409);
  const playedB = await call({ action: "play", room, cardId: cardB }, second.token);
  assert.equal(playedB.status, 200);
  a = (await state(room, first.token)).state;
  b = (await state(room, second.token)).state;
  assert.equal(a.lastReveal.turn, playedB.state.lastReveal.turn);
  assert.equal(b.lastReveal.turn, playedB.state.lastReveal.turn);
  if (a.phase === "finished") break;
}
assert.equal(a.phase, "finished");
assert.equal(a.score[0] + a.score[1] <= 5, true);
const ready = await call({ action: "rematch", room }, first.token);
assert.equal(ready.state.myRematch, true);
assert.equal((await state(room, second.token)).state.otherRematch, true);
const restarted = await call({ action: "rematch", room }, second.token);
assert.equal(restarted.state.phase, "playing");
assert.equal(restarted.state.batch, 1);
assert.equal(restarted.state.hand.length, 5);
console.log(`Two-player flow passed in room ${room}; winner seat ${a.champion}.`);
