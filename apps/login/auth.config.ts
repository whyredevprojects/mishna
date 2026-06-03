import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { authOptions } from "./src/auth";

// Used ONLY by `better-auth generate` to emit src/schema.sql. The in-memory
// SQLite DB is never used to store data — it just gives the CLI a concrete
// SQLite dialect to generate DDL from. D1 is SQLite, so the output applies
// directly to the mishna-auth D1 database. Not bundled into the worker.
export const auth = betterAuth({
  ...authOptions,
  database: new Database(":memory:"),
});
