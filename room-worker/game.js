export const SUITS = ["♠", "♥", "♣", "♦"];

export function freshDeck() {
  const cards = [];
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 13; rank++) {
      cards.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const j = random[0] % (i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function startBatch(game) {
  if (game.deck.length < 10) game.deck = freshDeck();
  game.batch += 1;
  game.turn = 1;
  game.score = [0, 0];
  game.pending = [null, null];
  game.hands = [game.deck.splice(-5), game.deck.splice(-5)];
  game.phase = "playing";
  game.version += 1;
}

export function createGame(firstToken) {
  return {
    players: [firstToken, null], deck: [], hands: [[], []], pending: [null, null],
    batch: 0, turn: 0, score: [0, 0], phase: "waiting", champion: null,
    lastReveal: null, rematch: [false, false], version: 1,
  };
}

export function playCard(game, seat, cardId) {
  if (game.phase !== "playing") throw new Error("现在不能出牌");
  if (game.pending[seat]) throw new Error("这一回合你已经选过牌了");
  const card = game.hands[seat].find((item) => item.id === cardId);
  if (!card) throw new Error("这张牌不在你的手里");
  game.pending[seat] = card;
  game.version += 1;
  if (!game.pending[0] || !game.pending[1]) return;

  const cards = [...game.pending];
  game.hands[0] = game.hands[0].filter((item) => item.id !== cards[0].id);
  game.hands[1] = game.hands[1].filter((item) => item.id !== cards[1].id);
  const winner = cards[0].rank === cards[1].rank ? null : Number(cards[1].rank > cards[0].rank);
  if (winner !== null) game.score[winner] += 1;
  const reveal = {
    batch: game.batch, turn: game.turn, cards, winner, score: [...game.score],
    batchTied: false,
  };
  game.lastReveal = reveal;
  game.pending = [null, null];
  if (game.turn === 5) {
    if (game.score[0] === game.score[1]) {
      reveal.batchTied = true;
      startBatch(game);
    } else {
      game.phase = "finished";
      game.champion = Number(game.score[1] > game.score[0]);
    }
  } else {
    game.turn += 1;
  }
  game.version += 1;
}

export function viewFor(game, room, seat) {
  return {
    room, seat, phase: game.phase, batch: game.batch, turn: game.turn,
    score: game.score, hand: game.hands[seat],
    otherCount: game.hands[1 - seat].length,
    myReady: Boolean(game.pending[seat]), otherReady: Boolean(game.pending[1 - seat]),
    joined: game.players.filter(Boolean).length,
    lastReveal: game.lastReveal, champion: game.champion,
    myRematch: game.rematch[seat], otherRematch: game.rematch[1 - seat],
    version: game.version,
  };
}
