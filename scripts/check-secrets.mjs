import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean),
  ),
];
const bad = [];
const patterns = [
  new RegExp("-----BEGIN " + "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
  new RegExp("(?:sk" + "-(?:proj-)?)[A-Za-z0-9_-]{32,}"),
  new RegExp("(?:gh" + "[pousr]_|github" + "_pat_)[A-Za-z0-9_]{30,}"),
  new RegExp("\\bS[A-Z2-7]{55}\\b"),
];
for (const file of files) {
  if (
    /(^|\/)\.env($|\.)|\.(pem|key|p12|pfx|keystore)$|(^|\/)\.data\//.test(file)
  ) {
    bad.push(file);
    continue;
  }
  const text = readFileSync(file);
  if (text.includes(0)) continue;
  if (patterns.some((p) => p.test(text.toString("utf8")))) bad.push(file);
}
if (bad.length) {
  console.error(
    "Potential secret files; review before committing:\n" + bad.join("\n"),
  );
  process.exit(1);
}
console.log(
  `Checked ${files.length} repository files: no recognised secret patterns or environment files. This is a limited scan, not a guarantee.`,
);
