import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DB = ReturnType<typeof drizzle<typeof schema>>;

// Cache the client on globalThis so Next's dev hot-reload reuses ONE pool across
// module re-evaluations instead of leaking a new pool per reload (which
// otherwise piles up until the pooler hits its connection limit).
const g = globalThis as unknown as { __jollyDb?: DB };

function init(): DB {
  if (g.__jollyDb) return g.__jollyDb;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set (Supabase connection string).");
  }
  // `prepare: false` is required with the Supabase transaction pooler (6543).
  // Tuning learned the hard way: the pooler intermittently hangs NEW connection
  // attempts, and the default 30s connect_timeout turned that into 30-120s API
  // stalls (admin metrics fans out 8 parallel queries → 8 cold opens). So:
  // fewer connections (max 4), keep them warm much longer (idle 120s), and
  // fail a hanging connect fast (10s) so the retry lands on a good socket.
  // keep_alive detects half-open sockets (the network flap leaves connections
  // that look alive but never answer — queries queued on them hang forever);
  // max_lifetime recycles every socket within 5 minutes, bounding any wedge.
  const client = postgres(connectionString, {
    prepare: false,
    max: 4,
    idle_timeout: 120,
    connect_timeout: 10,
    keep_alive: 30,
    max_lifetime: 300,
  });
  g.__jollyDb = drizzle(client, { schema });
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
