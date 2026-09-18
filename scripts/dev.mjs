import { spawn } from "node:child_process";
const manager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const children = [];
function run(args) {
  const p = spawn(manager, args, { stdio: "inherit", env: process.env });
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
