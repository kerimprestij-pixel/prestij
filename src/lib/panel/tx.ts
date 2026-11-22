// The executor panel services receive: the `db` client or a transaction (both share this API).
// Type-only module.
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import type * as dbSchema from "@/db/schema";

export type Tx = PgDatabase<PostgresJsQueryResultHKT, typeof dbSchema>;
