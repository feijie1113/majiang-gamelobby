const ROOM_PATTERN = /^[A-Z2-9]{8}$/;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function newRoomCode() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => ALPHABET[value % ALPHABET.length]).join("");
}

async function forward(env, room, data) {
  const id = env.ROOMS.idFromName(room);
  const stub = env.ROOMS.get(id);
  return stub.fetch(new Request("https://room.internal/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...data, room }),
  }));
}

export async function onRequest({ request, env }) {
  if (!env.ROOMS) return json({ error: "游戏服务还没接好" }, 503);
  if (request.method === "GET") {
    const url = new URL(request.url);
    const room = url.searchParams.get("room")?.toUpperCase();
    const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
    if (!ROOM_PATTERN.test(room || "") || !token) return json({ error: "房间信息不完整" }, 400);
    return forward(env, room, { action: "state", token });
  }
  if (request.method !== "POST") return json({ error: "不支持这个操作" }, 405);
  if (Number(request.headers.get("content-length")) > 2048) return json({ error: "请求太长" }, 413);
  let data;
  try { data = await request.json(); } catch { return json({ error: "请求格式不对" }, 400); }
  if (!data || typeof data !== "object") return json({ error: "请求格式不对" }, 400);
  const { action } = data;
  if (action === "create") {
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await forward(env, newRoomCode(), { action, token: crypto.randomUUID() });
      if (response.status !== 409) return response;
    }
    return json({ error: "房间号生成失败，请重试" }, 503);
  }
  const room = String(data.room || "").trim().toUpperCase();
  if (!ROOM_PATTERN.test(room)) return json({ error: "请输入八位房间号" }, 400);
  if (action === "join") return forward(env, room, { action, token: crypto.randomUUID() });
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return json({ error: "请重新进入房间" }, 401);
  if (action === "play") {
    if (typeof data.cardId !== "string" || data.cardId.length > 8) return json({ error: "选的牌不对" }, 400);
    return forward(env, room, { action, token, cardId: data.cardId });
  }
  if (action === "rematch") return forward(env, room, { action, token });
  return json({ error: "未知操作" }, 400);
}
