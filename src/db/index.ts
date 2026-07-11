import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;
type Client = ReturnType<typeof postgres>;

const onCF = process.env.DEPLOY_TARGET === "cloudflare";

// Node: ONE shared pool on globalThis — a persistent process, and this also stops
// Next's dev hot-reload from leaking a new pool per reload.
const g = globalThis as unknown as { __jollyDb?: DB };

function makeClient(connectionString: string): Client {
  return onCF
    ? postgres(connectionString, {
        // Workers rules: `fetch_types` runs a type-introspection query on connect
        // that hangs through the pooler; idle_timeout/max_lifetime/keep_alive
        // schedule timers that fire after the response when the isolate is frozen.
        // Sockets are closed explicitly via ctx.waitUntil in init() instead.
        prepare: false,
        fetch_types: false,
        max: 2,
        keep_alive: 0,
      })
    : postgres(connectionString, {
        // Supabase transaction pooler (6543) tuning — see git history for the whys
        prepare: false,
        max: 4,
        idle_timeout: 120,
        connect_timeout: 10,
        keep_alive: 30,
        max_lifetime: 300,
      });
}

function init(): DB {
  if (onCF) {
    // NO caching on Workers — ever. A client cached across requests (globally or
    // keyed on OpenNext's ctx/env, which is NOT unique per request) makes the next
    // request await I/O owned by a previous one → instant deadlock kill (1101).
    // Fresh client per db-access is cheap: Hyperdrive pools at the edge, and the
    // ranking RPC means a request makes ~1 top-level db call anyway.
    let cs: string | undefined;
    let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
    try {
      // require (not import) so local/Node builds never load the CF-only module
      const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
      const cf = getCloudflareContext();
      cs = (cf.env as unknown as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE?.connectionString;
      ctx = cf.ctx as unknown as { waitUntil(p: Promise<unknown>): void };
    } catch {
      /* no request context (build time / background) → direct URL below */
    }
    cs = cs ?? process.env.DATABASE_URL;
    if (!cs) throw new Error("Hyperdrive binding / DATABASE_URL not configured");
    const client = makeClient(cs);
    // Close the sockets IN REQUEST CONTEXT (the documented Hyperdrive pattern:
    // ctx.waitUntil(sql.end())). Without this they never close — postgres-js's
    // close timers freeze between requests — and they ACCUMULATE on the isolate
    // until new connections starve and the runtime kills requests instantly
    // (the intermittent fast-1101s). end() waits for in-flight queries first;
    // the 5s delay keeps the client alive across this request's queries.
    try {
      ctx?.waitUntil(new Promise((r) => setTimeout(r, 5000)).then(() => client.end()).catch(() => {}));
    } catch {
      /* no ctx — client is GC'd with the isolate */
    }
    return drizzle(client, { schema });
  }
  if (g.__jollyDb) return g.__jollyDb;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL is not set (Supabase connection string).");
  g.__jollyDb = drizzle(makeClient(cs), { schema });
  return g.__jollyDb;
}

/**
 * Run `fn` against a SCOPED db handle. On Workers this is the strictest possible
 * TCP discipline: a fresh client, used for exactly this unit of work, then
 * `end()`-ed IN the request before returning — no timers, no leftover sockets,
 * nothing shared across requests. On Node it's just the global pool.
 * Use for hot paths that must be bulletproof on CF (the ranking RPC).
 */
export async function withScopedDb<T>(fn: (d: DB) => Promise<T>): Promise<T> {
  if (!onCF) return fn(init());
  let cs: string | undefined;
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
    cs = (getCloudflareContext().env as unknown as { HYPERDRIVE?: { connectionString?: string } }).HYPERDRIVE?.connectionString;
  } catch { /* fall through */ }
  cs = cs ?? process.env.DATABASE_URL;
  if (!cs) throw new Error("Hyperdrive binding / DATABASE_URL not configured");
  // node-postgres, NOT postgres-js: postgres.js's end() waits on socket-close
  // events workerd never emits (awaiting it deadlocked every request; floating
  // it poisoned isolates). pg is the driver Cloudflare's own Hyperdrive examples
  // use — connect → query → await end() works per-request on workerd.
  const { Client } = require("pg") as typeof import("pg");
  const { drizzle: drizzlePg } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
  const client = new Client({ connectionString: cs });
  await client.connect();
  try {
    return await fn(drizzlePg(client, { schema }) as unknown as DB);
  } finally {
    await client.end().catch(() => {});
  }
}

// Lazy proxy: the connection (and the missing-env error) is deferred until the
// first actual query, so `next build` / imports don't require a live DB.
export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = init();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
