#!/usr/bin/env node
/**
 * Clean local dev — `npm run dev:clean`.
 *
 * A CF build (`npm run cf:deploy`) rewrites `.next` with CF-variant artifacts
 * (puppeteer / canvas aliased to empty, custom chunks). Running `next dev` on top
 * of that yields `ENOENT .next/server/pages/_document.js`, "Cannot find module"
 * chunk errors, and a **crash-looping** dev server — which shows up as GPU
 * sawtooth, because each failed inference request reloads the model. The cure is
 * always the same: wipe the build dirs and let dev rebuild clean. Run this after
 * every CF deploy (or any time dev acts haunted post-deploy).
 */
import { rmSync } from "node:fs";
import { execSync } from "node:child_process";

console.log("→ wiping .next / .open-next / .next-cf for a clean dev build…");
for (const dir of [".next", ".open-next", ".next-cf"]) rmSync(dir, { recursive: true, force: true });
console.log("→ starting next dev…\n");
execSync("npx next dev", { stdio: "inherit" });
