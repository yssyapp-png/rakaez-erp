import dotenv from "dotenv";
import { pool } from "../src/db/pool.js";

dotenv.config();

const parsedThreshold = Number(process.env.SECURITY_MONITOR_HIGH_EVENT_THRESHOLD || 1);
const highEventThreshold = Number.isInteger(parsedThreshold) && parsedThreshold > 0 ? parsedThreshold : 1;

try {
  const result = await pool.query(`
    SELECT
      (SELECT count(*)::integer
       FROM security_events
       WHERE occurred_at >= now() - interval '15 minutes'
         AND severity IN ('high','critical')) AS high_security_events_15m,
      (SELECT count(*)::integer
       FROM government_integration_attempts
       WHERE status = 'processing'
         AND created_at < now() - interval '5 minutes') AS stuck_government_attempts,
      (SELECT count(*)::integer
       FROM government_integration_attempts
       WHERE status = 'manual_review') AS government_attempts_requiring_review,
      (SELECT count(*)::integer
       FROM auth_login_guards
       WHERE blocked_until > now()) AS active_login_blocks
  `);
  const counts = result.rows[0];
  const alert =
    Number(counts.high_security_events_15m) >= highEventThreshold ||
    Number(counts.stuck_government_attempts) > 0 ||
    Number(counts.government_attempts_requiring_review) > 0;

  // Intentionally emit aggregate counts only: no tenant, user, address,
  // invoice, request, or credential data may leave through monitoring logs.
  console.log(JSON.stringify({
    ok: !alert,
    checkedAt: new Date().toISOString(),
    counts,
  }));
  if (alert) process.exitCode = 2;
} catch {
  console.error(JSON.stringify({ ok: false, error: "security_monitor_unavailable" }));
  process.exitCode = 3;
} finally {
  await pool.end().catch(() => {});
}
