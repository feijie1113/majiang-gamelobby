import { DurableObject } from "cloudflare:workers";
import { createGame, removePlayer, startBatch, playCard, viewFor } from "./game.js";

const EMPTY_ROOM_MS = 10 * 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export class CompareRoom extends DurableObject {
  sockets(game) {
    return this.ctx.getWebSockets().filter((ws) => {
      const token = ws.deserializeAttachment()?.token;
      return ws.readyState === 1 && game.players.includes(token);
    });
  }

  online(game) {
    const tokens = new Set(this.sockets(game).map((ws) => ws.deserializeAttachment().token));
    return game.players.map((token) => Boolean(token && tokens.has(token)));
  }

  broadcast(game, room) {
    const online = this.online(game);
    for (const ws of this.sockets(game)) {
      const seat = game.players.indexOf(ws.deserializeAttachment().token);
      try { ws.send(JSON.stringify({ type: "state", state: viewFor(game, room, seat, online) })); }
      catch { /* The close handler will update presence. */ }
    }
  }

  async syncLifetime(game) {
    if (this.sockets(game).length) game.emptySince = null;
    else game.emptySince ||= Date.now();
    await this.ctx.storage.put("game", game);
    await this.ctx.storage.setAlarm((game.emptySince || Date.now()) + EMPTY_ROOM_MS);
  }

  async fetch(request) {
    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return this.connect(request);
    }
    let input;
    try { input = await request.json(); } catch { return json({ error: "请求格式不对" }, 400); }
    if (!input || typeof input !== "object") return json({ error: "请求格式不对" }, 400);
    const { action, room, token } = input;
    if (typeof token !== "string" || token.length < 20) return json({ error: "请重新进入房间" }, 401);

    try {
      const result = await this.ctx.storage.transaction(async (tx) => {
        let game = await tx.get("game");
        if (action === "create") {
          if (game) return { status: 409, data: { error: "房间号重复，请重试" } };
          game = createGame(token);
          await tx.put("game", game);
          return { status: 201, data: { token, state: viewFor(game, room, 0) }, game, changed: true, created: true };
        }
        if (!game) return { status: 404, data: { error: "找不到这个房间" } };
        if (game.emptySince && Date.now() - game.emptySince >= EMPTY_ROOM_MS && !this.sockets(game).length) {
          return { status: 404, data: { error: "房间已过期，请重新开一桌" }, expired: true };
        }

        if (action === "join") {
          if (game.players.every(Boolean)) return { status: 409, data: { error: "房间已满；原玩家可直接重进，房里的人也可以移出离线玩家" } };
          const seat = game.players[0] ? 1 : 0;
          game.players[seat] = token;
          if (game.players.every(Boolean)) startBatch(game);
          else game.version += 1;
          if (!this.sockets(game).length) game.emptySince = Date.now();
          await tx.put("game", game);
          return { status: 200, data: { token, state: viewFor(game, room, seat, this.online(game)) }, game, changed: true };
        }

        const seat = game.players.indexOf(token);
        if (seat < 0) return { status: 403, data: { error: "你不在这个房间里" } };
        if (action === "state") return { status: 200, data: { state: viewFor(game, room, seat, this.online(game)) } };
        if (action === "play") {
          playCard(game, seat, input.cardId);
        } else if (action === "rematch") {
          if (game.phase !== "finished") return { status: 409, data: { error: "这局还没结束" } };
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
        } else if (action === "kick") {
          const online = this.online(game);
          if (!online[seat] || online[1 - seat] || !game.players[1 - seat]) {
            return { status: 409, data: { error: "只有房里唯一在线的人能移出离线玩家" } };
          }
          removePlayer(game, 1 - seat);
        } else if (action === "leave") {
          removePlayer(game, seat);
        } else {
          return { status: 400, data: { error: "未知操作" } };
        }
        await tx.put("game", game);
        return {
          status: 200, data: action === "leave" ? { left: true } : { state: viewFor(game, room, seat, this.online(game)) },
          game, changed: true, removedToken: action === "leave" ? token : null,
        };
      });

      if (result.expired) await this.ctx.storage.deleteAll();
      if (result.created) await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS);
      if (result.removedToken) {
        for (const ws of this.ctx.getWebSockets()) {
          if (ws.deserializeAttachment()?.token === result.removedToken) ws.close(4000, "left room");
        }
      }
      if (result.changed) {
        this.broadcast(result.game, room);
        if (action === "leave") await this.syncLifetime(result.game);
      }
      return json(result.data, result.status);
    } catch (error) {
      if (error instanceof Error && /不能出牌|已经选过|不在你的手里/.test(error.message)) {
        return json({ error: error.message }, 409);
      }
      console.error(error);
      return json({ error: "房间暂时出了点问题，稍后再试" }, 500);
    }
  }

  async connect(request) {
    const url = new URL(request.url);
    const room = url.searchParams.get("room")?.toUpperCase();
    const token = url.searchParams.get("token");
    if (!token || token.length < 20) return json({ error: "请重新进入房间" }, 401);
    const game = await this.ctx.storage.get("game");
    if (!game) return json({ error: "找不到这个房间" }, 404);
    const seat = game.players.indexOf(token);
    if (seat < 0) return json({ error: "你不在这个房间里" }, 403);
    if (game.emptySince && Date.now() - game.emptySince >= EMPTY_ROOM_MS && !this.sockets(game).length) {
      await this.ctx.storage.deleteAll();
      return json({ error: "房间已过期，请重新开一桌" }, 404);
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ token, room });
    game.emptySince = null;
    await this.ctx.storage.put("game", game);
    await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS);
    this.broadcast(game, room);
    return new Response(null, { status: 101, webSocket: client });
  }

  async socketGone(ws) {
    const room = ws.deserializeAttachment()?.room;
    const game = await this.ctx.storage.get("game");
    if (!game) return;
    await this.syncLifetime(game);
    this.broadcast(game, room);
  }

  async webSocketClose(ws) { await this.socketGone(ws); }
  async webSocketError(ws) { try { ws.close(); } catch {} await this.socketGone(ws); }

  async alarm() {
    const game = await this.ctx.storage.get("game");
    if (!game) return;
    if (this.sockets(game).length) {
      game.emptySince = null;
      await this.ctx.storage.put("game", game);
      await this.ctx.storage.setAlarm(Date.now() + EMPTY_ROOM_MS);
    } else if (!game.emptySince) {
      game.emptySince = Date.now();
      await this.ctx.storage.put("game", game);
      await this.ctx.storage.setAlarm(game.emptySince + EMPTY_ROOM_MS);
    } else if (Date.now() < game.emptySince + EMPTY_ROOM_MS) {
      await this.ctx.storage.setAlarm(game.emptySince + EMPTY_ROOM_MS);
    } else {
      await this.ctx.storage.deleteAll();
    }
  }
}

export default {
  fetch() { return new Response("Not found", { status: 404 }); },
};
