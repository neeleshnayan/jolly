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
  // `prepare: false` is required with the Supabase transaction pooler (6543);
  // `max` + `idle_timeout` bound the footprint and release idle connections.
  const client = postgres(connectionString, { prepare: false, max: 8, idle_timeout: 20 });
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
