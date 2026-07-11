import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

const onCF = process.env.DEPLOY_TARGET === "cloudflare";

// Node: ONE shared pool on globalThis — a persistent process, and this also stops
// Next's dev hot-reload from leaking a new pool per reload.
const g = globalThis as unknown as { __jollyDb?: DB };
// Cloudflare Workers: ONE client PER REQUEST, keyed by the request's execution
// context. A client cached across requests reuses a socket that Cloudflare severs
// when it freezes the isolate between requests → the intermittent fast-500s we
// saw. Fresh-per-request is the documented Hyperdrive + postgres.js pattern;
// Hyperdrive does the real connection pooling at the edge.
const cfClients = new WeakMap<object, DB>();

function makeDb(connectionString: string): DB {
  const client = onCF
    ? postgres(connectionString, {
        // `fetch_types` runs a type-introspection query on connect that hangs
        // through the pooler on Workers; the timer-based keep_alive/max_lifetime
        // misbehave because Workers freeze the isolate between requests.
        prepare: false,
        fetch_types: false,
        // the ranking path fans out ~11 parallel queries; max:1 serialized them
        // through the pooler (~6s + hangs). Let them run concurrently.
        max: 8,
        idle_timeout: 10,
      })
    : postgres(connectionString, {
        prepare: false,
        max: 4,
        idle_timeout: 120,
        connect_timeout: 10,
        keep_alive: 30,
        max_lifetime: 300,
      });
  return drizzle(client, { schema });
}

function init(): DB {
  if (onCF) {
    try {
      // require (not import) so local/Node builds never load the CF-only module
      const { getCloudflareContext } = require("@opennextjs/cloudflare") as typeof import("@opennextjs/cloudflare");
      const cf = getCloudflareContext();
      // key on the per-request ExecutionContext → a fresh client each request.
      // (env is shared across requests, so it's only the last-resort key.)
      const key = (cf.ctx ?? cf.env) as object;
      let reqDb = cfClients.get(key);
      if (!reqDb) {
        const env = cf.env as unknown as { HYPERDRIVE?: { connectionString?: string } };
        const cs = env.HYPERDRIVE?.connectionString ?? process.env.DATABASE_URL;
        if (!cs) throw new Error("Hyperdrive binding / DATABASE_URL not configured");
        reqDb = makeDb(cs);
        cfClients.set(key, reqDb);
      }
      return reqDb;
    } catch {
      /* no CF request context (e.g. build time) → fall through to a global client */
    }
  }
  if (g.__jollyDb) return g.__jollyDb;
  const cs = process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL is not set (Supabase connection string).");
  g.__jollyDb = makeDb(cs);
  return g.__jollyDb;
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
