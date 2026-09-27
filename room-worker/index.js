import { DurableObject } from "cloudflare:workers";
import { createGame, startBatch, playCard, viewFor } from "./game.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export class CompareRoom extends DurableObject {
  async fetch(request) {
    let input;
    try { input = await request.json(); } catch { return json({ error: "请求格式不对" }, 400); }
    const { action, room, token } = input;
    if (typeof token !== "string" || token.length < 20) return json({ error: "请重新进入房间" }, 401);

    try {
      return await this.ctx.storage.transaction(async (tx) => {
        let game = await tx.get("game");
        if (action === "create") {
          if (game) return json({ error: "房间号重复，请重试" }, 409);
          game = createGame(token);
          await tx.put("game", game);
          return json({ token, state: viewFor(game, room, 0) }, 201);
        }
        if (!game) return json({ error: "找不到这个房间" }, 404);

        if (action === "join") {
          if (game.players[1]) return json({ error: "房间已经坐满了" }, 409);
          game.players[1] = token;
          startBatch(game);
          await tx.put("game", game);
          return json({ token, state: viewFor(game, room, 1) });
        }

        const seat = game.players.indexOf(token);
        if (seat < 0) return json({ error: "你不在这个房间里" }, 403);
        if (action === "state") return json({ state: viewFor(game, room, seat) });
        if (action === "play") {
          playCard(game, seat, input.cardId);
        } else if (action === "rematch") {
          if (game.phase !== "finished") return json({ error: "这局还没结束" }, 409);
          game.rematch[seat] = true;
          game.version += 1;
          if (game.rematch.every(Boolean)) {
            game.deck = [];
            game.batch = 0;
            game.champion = null;
            game.lastReveal = null;
            game.rematch = [false, false];
            startBatch(game);
          }
        } else {
          return json({ error: "未知操作" }, 400);
        }
        await tx.put("game", game);
        return json({ state: viewFor(game, room, seat) });
      });
    } catch (error) {
      if (error instanceof Error && /不能出牌|已经选过|不在你的手里/.test(error.message)) {
        return json({ error: error.message }, 409);
      }
      console.error(error);
      return json({ error: "房间暂时出了点问题，稍后再试" }, 500);
    }
  }
}

export default {
  fetch() { return new Response("Not found", { status: 404 }); },
};
