import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const manager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
function run(args) {
  // Newer Node releases cannot always spawn .cmd wrappers directly on Windows.
  const command = process.platform === "win32" ? process.env.ComSpec : manager;
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", manager, ...args] : args;
  const p = spawn(command, commandArgs, {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "development" },
  });
  children.push(p);
  return p;
}
const build = run(["--filter", "@workspace/api-server", "build"]);
build.on("exit", (code) => {
  if (code) process.exit(code);
  run(["--filter", "@workspace/puente", "dev"]);
  children.push(
    spawn(process.execPath, ["artifacts/api-server/dist/index.mjs"], {
      stdio: "inherit",
      env: process.env,
    }),
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const p of children) p.kill(signal);
  });
