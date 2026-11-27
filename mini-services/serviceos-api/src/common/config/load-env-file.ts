import { config } from 'dotenv';

/**
 * Environment loading with correct precedence per environment:
 *  - production/test: real environment variables always win (12-factor, and
 *    the test suite injects its own database URL),
 *  - development: the project .env overrides inherited shell exports, because
 *    local tooling may leak unrelated DATABASE_URL values into the process
 *    environment (observed with the sandbox platform runner).
 *
 * SIDE-EFFECTING MODULE: it must be the first import in every entrypoint so
 * that config is applied before any module reads process.env at import time.
 */
export function loadEnvFile(): void {
  config({ override: process.env.NODE_ENV === 'development', quiet: true });
}

loadEnvFile();
