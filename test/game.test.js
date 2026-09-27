import test from "node:test";
import assert from "node:assert/strict";
import { createGame, freshDeck, playCard, startBatch, viewFor } from "../room-worker/game.js";

function room() {
  const game = createGame("player-one-token");
  game.players[1] = "player-two-token";
  startBatch(game);
  return game;
}

test("52 张牌不重复，每人拿到 5 张", () => {
  assert.equal(new Set(freshDeck().map((card) => card.id)).size, 52);
  const game = room();
  assert.equal(game.hands[0].length, 5);
  assert.equal(game.hands[1].length, 5);
  assert.equal(new Set([...game.hands[0], ...game.hands[1]].map((card) => card.id)).size, 10);
  assert.equal(game.deck.length, 42);
});

test("A 小于 K，双方都选好前不会泄漏手牌", () => {
  const game = room();
  game.hands[0][0] = { id: "♠-1", suit: "♠", rank: 1 };
  game.hands[1][0] = { id: "♥-13", suit: "♥", rank: 13 };
  playCard(game, 0, "♠-1");
  assert.equal(game.turn, 1);
  assert.equal(viewFor(game, "ABCDEFGH", 1).otherReady, true);
  assert.equal(JSON.stringify(viewFor(game, "ABCDEFGH", 1)).includes("♠-1"), false);
  playCard(game, 1, "♥-13");
  assert.deepEqual(game.score, [0, 1]);
  assert.equal(game.turn, 2);
});

test("同点数不计胜，五局打平自动加赛", () => {
  const game = room();
  game.hands = [
    [1, 2, 3, 4, 5].map((rank) => ({ id: `♠-${rank}`, suit: "♠", rank })),
    [1, 2, 3, 4, 5].map((rank) => ({ id: `♥-${rank}`, suit: "♥", rank })),
  ];
  for (let rank = 1; rank <= 5; rank++) {
    playCard(game, 0, `♠-${rank}`);
    playCard(game, 1, `♥-${rank}`);
  }
  assert.equal(game.batch, 2);
  assert.equal(game.turn, 1);
  assert.equal(game.lastReveal.batchTied, true);
  assert.deepEqual(game.score, [0, 0]);
  assert.equal(game.hands[0].length, 5);
});

test("剩余不足十张时换牌堆", () => {
  const game = room();
  game.deck = game.deck.slice(0, 9);
  startBatch(game);
  assert.equal(game.deck.length, 42);
});

test("五局决出胜负后停止出牌", () => {
  const game = room();
  game.hands = [
    [9, 10, 11, 12, 13].map((rank) => ({ id: `♠-${rank}`, suit: "♠", rank })),
    [1, 2, 3, 4, 5].map((rank) => ({ id: `♥-${rank}`, suit: "♥", rank })),
  ];
  for (let i = 0; i < 5; i++) {
    playCard(game, 0, game.hands[0][0].id);
    playCard(game, 1, game.hands[1][0].id);
  }
  assert.equal(game.phase, "finished");
  assert.equal(game.champion, 0);
  assert.deepEqual(game.score, [5, 0]);
  assert.throws(() => playCard(game, 0, "♠-1"), /不能出牌/);
});
