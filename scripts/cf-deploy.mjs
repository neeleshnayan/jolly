#!/usr/bin/env node
/**
 * Clean Cloudflare deploy — `npm run cf:deploy`.
 *
 * The bare `opennextjs-cloudflare build && deploy` fails; this bakes in every fix:
 *   1. DEPLOY_TARGET=cloudflare must be set AT BUILD TIME, or the CF aliases
 *      (puppeteer / canvas → empty) don't apply and the native `.node` bundling
 *      breaks the build.
 *   2. A stale `.open-next` from a prior aliases-off run poisons the next build
 *      (the phantom `canvas.node` error) → wipe it first.
 *   3. The deploy step needs a Hyperdrive LOCAL connection string even though the
 *      binding is remote — pull it from .env.local.
 *
 * NOTE: OpenNext hardcodes `.next`, so a CF build shares it with `next dev` and
 * rewrites it with CF-variant artifacts. After this, run `npm run dev:clean`
 * before `next dev` again (and it stops any running crunch — progress is saved).
 */
import { rmSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/** Read a KEY from .env.local, quote- and inline-comment-safe. */
function readEnv(key) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  if (!line) return "";
  const v = line.slice(key.length + 1).trim();
  const quoted = v.match(/^"([^"]*)"/) || v.match(/^'([^']*)'/);
  return quoted ? quoted[1] : v.split(/\s+#/)[0].trim();
}

console.log("→ wiping stale build dirs (.open-next / .next / .next-cf)…");
for (const dir of [".open-next", ".next", ".next-cf"]) rmSync(dir, { recursive: true, force: true });

const env = {
  ...process.env,
  DEPLOY_TARGET: "cloudflare",
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: readEnv("DATABASE_URL"),
};
if (!env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE) {
  console.error("✗ DATABASE_URL not found in .env.local — the deploy step needs it.");
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { stdio: "inherit", env });
console.log("→ building for Cloudflare…");
run("npx opennextjs-cloudflare build");
console.log("→ deploying…");
run("npx opennextjs-cloudflare deploy");

console.log("\n✅ Deployed. This rewrote .next — run `npm run dev:clean` before `next dev`.");
