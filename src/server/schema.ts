/**
 * Database compatibility contract between this code and Supabase.
 *
 * - REQUIRED_SCHEMA_VERSION must equal the schema_version written by the newest migration.
 * - EXPECTED_MIGRATIONS lists every file in supabase/migrations (a unit test enforces this).
 * The server refuses campaign requests when the database is older than the code, and
 * /api/apex?op=health reports exactly which migrations are missing.
 */
export const REQUIRED_SCHEMA_VERSION = 6;

export const EXPECTED_MIGRATIONS: readonly string[] = ['20261101145653', '20261101151000', '20261101160000', '20261101173039', '20261101200504', '20261101201210', '20261101202637', '20261101212350', '20261104090000', '20261104220752', '20261105120000', '20261106100000'];

