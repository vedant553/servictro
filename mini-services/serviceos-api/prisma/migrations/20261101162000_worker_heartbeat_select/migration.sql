-- ServiceOS migration — follow-up to 20261101154951 (SEC-03).
--
-- PostgreSQL UPDATE statements read columns for their WHERE clause and
-- RETURNING projection, which requires SELECT privilege in addition to
-- UPDATE. The worker's heartbeat write (`UPDATE worker_heartbeats SET ...
-- WHERE id = 'singleton' RETURNING ...`) therefore also needs SELECT.
GRANT SELECT ON TABLE worker_heartbeats TO serviceos_worker;
