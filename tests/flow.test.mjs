import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

test("unconfigured money integrations fail closed", async () => {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const env = { ...process.env, API_PORT: String(port), NODE_ENV: "test" };
  delete env.APP_ACCESS_CODE;
  delete env.OPENAI_API_KEY;
  delete env.OPENAI_MODEL;
  delete env.X402_FACILITATOR_URL;
  const child = spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], { env, stdio: "ignore" });
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/api/puente/config`)).ok) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const config = await fetch(`http://127.0.0.1:${port}/api/puente/config`).then((response) => response.json());
    assert.equal(config.chatMode, "live");
    assert.equal(config.paymentMode, "unavailable");
    const session = await fetch(`http://127.0.0.1:${port}/api/puente/session`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(session.status, 503);
    assert.match((await session.json()).error, /access code/i);
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
  }
});
