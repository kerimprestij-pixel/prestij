// PostgreSQL error helpers. Drizzle wraps driver errors (DrizzleQueryError.cause), so walk the chain.

type PgLikeError = { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };

function* chain(error: unknown): Generator<PgLikeError> {
  let current: unknown = error;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    yield current as PgLikeError;
    current = (current as PgLikeError).cause;
  }
}

/** SQLSTATE of the first PostgreSQL error in the cause chain, e.g. "23505". */
export function pgErrorCode(error: unknown): string | null {
  for (const e of chain(error)) if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return null;
}

/** Constraint name of a constraint violation, when the driver reports it. */
export function pgConstraint(error: unknown): string | null {
  for (const e of chain(error)) {
    const name = e.constraint_name ?? e.constraint;
    if (typeof name === "string") return name;
  }
  return null;
}

export const isUniqueViolation = (error: unknown) => pgErrorCode(error) === "23505";

/**
 * What may be logged about an error: the SQLSTATE, the constraint and the error class, never the
 * message. Drizzle's DrizzleQueryError message is "Failed query: <sql> params: <every parameter>", which
 * would put buyers' e-mail, phone, address and national ID into the server log.
 */
export function safeErrorInfo(error: unknown): { name: string; code: string | null; constraint: string | null } {
  const name = error instanceof Error ? error.name : typeof error;
  return { name, code: pgErrorCode(error), constraint: pgConstraint(error) };
}
