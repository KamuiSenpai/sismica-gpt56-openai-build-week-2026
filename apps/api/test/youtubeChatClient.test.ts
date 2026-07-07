import assert from "node:assert/strict";
import test from "node:test";

import {
  hasYoutubeChatCredentials,
  insertYoutubeLiveChatMessage,
  resolveYoutubeLiveChat,
  YoutubeApiError
} from "../../../packages/shared/src/youtubeChat.ts";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("valida credenciales minimas para el chat de YouTube", () => {
  assert.equal(
    hasYoutubeChatCredentials({
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh"
    }),
    true
  );
  assert.equal(
    hasYoutubeChatCredentials({
      clientId: "client",
      clientSecret: "",
      refreshToken: "refresh"
    }),
    false
  );
});

test("resuelve broadcast activo y liveChatId usando OAuth refresh token", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push({ url, method: init?.method ?? "GET" });

    if (url === "https://oauth2.googleapis.com/token") {
      assert.equal(init?.method, "POST");
      assert.equal(
        init?.headers && "Content-Type" in init.headers ? init.headers["Content-Type"] : "",
        "application/x-www-form-urlencoded"
      );
      return jsonResponse({ access_token: "token-123" });
    }

    assert.match(url, /^https:\/\/www\.googleapis\.com\/youtube\/v3\/liveBroadcasts\?/);
    assert.equal(
      init?.headers && "Authorization" in init.headers ? init.headers.Authorization : "",
      "Bearer token-123"
    );
    return jsonResponse({
      items: [{ id: "broadcast-1", snippet: { liveChatId: "chat-1" } }]
    });
  };

  const resolved = await resolveYoutubeLiveChat(
    {
      clientId: "client",
      clientSecret: "secret",
      refreshToken: "refresh",
      channelId: "UC123"
    },
    fetchMock
  );

  assert.deepEqual(
    calls.map((call) => call.method),
    ["POST", "GET"]
  );
  assert.equal(resolved.accessToken, "token-123");
  assert.equal(resolved.channelId, "UC123");
  assert.equal(resolved.activeBroadcastId, "broadcast-1");
  assert.equal(resolved.liveChatId, "chat-1");
});

test("publica un mensaje en el liveChat activo", async () => {
  const fetchMock: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input);
    assert.equal(url, "https://www.googleapis.com/youtube/v3/liveChat/messages?part=id,snippet");
    assert.equal(init?.method, "POST");
    assert.equal(
      init?.headers && "Authorization" in init.headers ? init.headers.Authorization : "",
      "Bearer token-123"
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.snippet.liveChatId, "chat-1");
    assert.equal(body.snippet.textMessageDetails.messageText, "[PRUEBA] Mensaje de verificacion.");
    return jsonResponse({ id: "msg-1" });
  };

  const result = await insertYoutubeLiveChatMessage(
    { accessToken: "token-123", liveChatId: "chat-1" },
    "[PRUEBA] Mensaje de verificacion.",
    fetchMock
  );

  assert.equal(result.messageId, "msg-1");
});

test("falla de forma controlada cuando no existe liveChatId activo", async () => {
  await assert.rejects(
    () => insertYoutubeLiveChatMessage({ accessToken: "token-123", liveChatId: null }, "hola"),
    (error: unknown) =>
      error instanceof YoutubeApiError && error.status === 409 && error.reason === "chat_disabled"
  );
});
