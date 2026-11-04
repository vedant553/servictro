/**
 * Jest setup (setupFiles — runs before anything imports application code):
 * points every service at the isolated TEST database before module load.
 *
 * TEST_PG_HOST/TEST_PG_PORT let CI run the same suite against its PostgreSQL
 * service container (mapped to 5432) without touching test semantics.
 */
const host = process.env.TEST_PG_HOST ?? '127.0.0.1';
const port = process.env.TEST_PG_PORT ?? '5433';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = `postgresql://serviceos_app:serviceos_app_dev@${host}:${port}/serviceos_test`;
process.env.DATABASE_MIGRATE_URL = `postgresql://postgres:postgres@${host}:${port}/serviceos_test`;
// Least-privilege worker role (SEC-03) — granted by the migration on the
// test database; worker-role tests connect with these credentials.
process.env.DATABASE_WORKER_URL = `postgresql://serviceos_worker:serviceos_worker_dev@${host}:${port}/serviceos_test`;
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
process.env.APP_URL = 'http://localhost:3000';
process.env.API_GATEWAY_PORT = '';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = '../../data/uploads-test';
process.env.MALWARE_SCANNER = 'signature';
// Rate limiting off for the shared integration suite (SEC-02 test seam —
// the dedicated rate-limit spec spawns its own process with it enabled).
process.env.RATE_LIMITING = 'off';
process.env.WORKER_POLL_MS = '60000';
process.env.LOG_LEVEL = 'warn';
