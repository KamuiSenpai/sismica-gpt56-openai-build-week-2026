import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "../src/app.js";
import { StreamBroker } from "../src/services/streamBroker.js";

test("la API bloquea origenes ajenos y cierra operaciones sin token", async (context) => {
  const server = createServer(createApp(new StreamBroker()));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const rejectedOrigin = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://not-allowed.example" }
  });
  assert.equal(rejectedOrigin.status, 403);
  assert.equal(rejectedOrigin.headers.get("cross-origin-resource-policy"), "cross-origin");
  assert.match(rejectedOrigin.headers.get("x-request-id") ?? "", /^[a-f0-9-]{36}$/);
  assert.equal(((await rejectedOrigin.json()) as { code: string }).code, "origin_not_allowed");

  const protectedOperation = await fetch(`${baseUrl}/api/tts/runtime`);
  assert.equal(protectedOperation.status, 503);
  assert.equal(((await protectedOperation.json()) as { code: string }).code, "operator_auth_not_configured");
});
