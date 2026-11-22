// Local-only guard of the DB tests: refuses a DATABASE_URL that is not on this machine, at once and before
// anything connects. Loaded three ways, so no path skips it: as the first import of EVERY tests/db/*.test.ts
// (a unit test in tests/unit/golive-config.test.ts enforces it, so a single file run directly is guarded
// too, even when the shell's DATABASE_URL wins over --env-file), by `npm run test:db` once up front, and
// with --import in every test process.
import { localDatabaseProblem } from "./local-db";

const problem = localDatabaseProblem(process.env.DATABASE_URL);
if (problem) {
  console.error(`[test:db] Refusing to run: ${problem}`);
  process.exit(1);
}
