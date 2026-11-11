import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

if (Bun.env.NODE_ENV === "production" && !Bun.env.TURSO_CONNECTION_URL)
  throw new Error("Missing TURSO_CONNECTION_URL environment variable");

// Tests always get a throwaway database, whatever the environment says.
const url =
  Bun.env.NODE_ENV === "test" ? ":memory:" : (Bun.env.TURSO_CONNECTION_URL ?? "file:local.db");

export const db = drizzle({ connection: { url, authToken: Bun.env.TURSO_AUTH_TOKEN } });

await migrate(db, { migrationsFolder: `${import.meta.dir}/../migrations` });
