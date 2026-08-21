import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db/pool.js";
import { createSafeRouter } from "../utils/safe-router.js";
import {
  LOGIN_FAILURE_LIMIT,
  LOGIN_FAILURE_WINDOW_MINUTES,
  LOGIN_LOCK_MINUTES,
  loginSubjectHash,
  recordSecurityEvent,
  requestSecurityContext,
  securityHash,
} from "../utils/security.js";
import { clearAuthCookie, readAuthCookie, setAuthCookie } from "../utils/http-security.js";

const router = createSafeRouter();
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "12h";
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
const DUMMY_PASSWORD_HASH = "$2b$12$auprVnPt7wPdj73g2cgtBu2FMp9r8AsO6Xtum6zffIh9F5YN56H8G";

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}
if (!Number.isInteger(SESSION_TTL_HOURS) || SESSION_TTL_HOURS < 1 || SESSION_TTL_HOURS > 24) {
  throw new Error("SESSION_TTL_HOURS must be a whole number from 1 to 24");
}

export function isAcceptablePassword(value) {
  const password = String(value || "");
  return password.length >= 12 && password.length <= 128 && /\p{L}/u.test(password) && /\d/u.test(password);
}

function issueAccessToken(user, sessionId) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      branchId: user.branch_id ?? user.branchId,
      organizationId: user.organization_id ?? user.organizationId,
      sid: sessionId,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, algorithm: "HS256" }
  );
}

export function jwtExpirySeconds(value = JWT_EXPIRES_IN) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value);
  const match = /^(\d+)(s|m|h|d)$/i.exec(String(value || "").trim());
  if (!match) throw new Error("JWT_EXPIRES_IN must use a supported duration such as 30m or 12h");
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()];
  return Number(match[1]) * multiplier;
}

if (jwtExpirySeconds() > SESSION_TTL_HOURS * 3600) {
  throw new Error("JWT_EXPIRES_IN must not exceed SESSION_TTL_HOURS");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    branchId: user.branch_id ?? user.branchId ?? null,
    organizationId: user.organization_id ?? user.organizationId,
    email: user.email,
  };
}

async function createSession(db, user, req) {
  const sessionId = crypto.randomUUID();
  const { ipHash, userAgentHash } = requestSecurityContext(req);
  const result = await db.query(
    `INSERT INTO user_sessions
       (id, organization_id, user_id, ip_hash, user_agent_hash, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + ($6::text || ' hours')::interval)
     RETURNING id, expires_at`,
    [sessionId, user.organization_id ?? user.organizationId, user.id, ipHash, userAgentHash, SESSION_TTL_HOURS]
  );
  return result.rows[0];
}

async function checkLoginGuard(db, subjectHash) {
  const result = await db.query(
    `SELECT blocked_until FROM auth_login_guards
     WHERE subject_hash = $1 AND blocked_until > now()`,
    [subjectHash]
  );
  return result.rows[0]?.blocked_until || null;
}

async function recordLoginFailure(db, subjectHash, organizationId) {
  const result = await db.query(
    `INSERT INTO auth_login_guards
       (subject_hash, organization_id, failure_count, window_started_at, last_failed_at, updated_at)
     VALUES ($1,$2,1,now(),now(),now())
     ON CONFLICT (subject_hash) DO UPDATE SET
       organization_id = COALESCE(EXCLUDED.organization_id, auth_login_guards.organization_id),
       failure_count = CASE
         WHEN auth_login_guards.window_started_at < now() - ($3::text || ' minutes')::interval THEN 1
         ELSE auth_login_guards.failure_count + 1
       END,
       window_started_at = CASE
         WHEN auth_login_guards.window_started_at < now() - ($3::text || ' minutes')::interval THEN now()
         ELSE auth_login_guards.window_started_at
       END,
       last_failed_at = now(),
       blocked_until = CASE
         WHEN (CASE
           WHEN auth_login_guards.window_started_at < now() - ($3::text || ' minutes')::interval THEN 1
           ELSE auth_login_guards.failure_count + 1
         END) >= $4 THEN now() + ($5::text || ' minutes')::interval
         ELSE auth_login_guards.blocked_until
       END,
       updated_at = now()
     RETURNING failure_count, blocked_until`,
    [subjectHash, organizationId, LOGIN_FAILURE_WINDOW_MINUTES, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_MINUTES]
  );
  return result.rows[0];
}

async function clearLoginGuard(db, subjectHash) {
  await db.query("DELETE FROM auth_login_guards WHERE subject_hash = $1", [subjectHash]);
}

async function finishAuthentication(db, user, req, eventType) {
  const session = await createSession(db, user, req);
  await recordSecurityEvent(db, {
    req,
    organizationId: user.organization_id ?? user.organizationId,
    userId: user.id,
    sessionId: session.id,
    eventType,
    outcome: "success",
  });
  return { token: issueAccessToken(user, session.id), session };
}

/** Public signup creates only a new tenant owner. Existing tenants use invites. */
router.post("/register", async (req, res) => {
  if (process.env.NODE_ENV === "production" && process.env.PUBLIC_REGISTRATION_ENABLED !== "true") {
    return res.status(403).json({ error: "public_registration_disabled" });
  }
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const role = body.role || "customer";
  const branchId = body.branchId ?? null;
  const businessName = String(body.businessName || "").trim();
  const organizationId = body.organizationId;
  if (!name || !email || !password) return res.status(400).json({ error: "missing_fields" });
  if (name.length > 120 || businessName.length > 200 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "invalid_registration_fields" });
  }
  if (!isAcceptablePassword(password)) return res.status(400).json({ error: "weak_password" });
  if (role !== "admin" || organizationId || branchId) return res.status(403).json({ error: "invitation_required" });
  if (!businessName) return res.status(400).json({ error: "missing_business_name" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const loginCode = `RKZ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const orgRes = await client.query(
      `INSERT INTO organizations (name, login_code, plan, subscription_status, trial_ends_at)
       VALUES ($1, $2, 'professional', 'trialing', now() + interval '14 days') RETURNING id, login_code`,
      [businessName, loginCode]
    );
    const orgId = orgRes.rows[0].id;
    const newOrganizationCode = orgRes.rows[0].login_code;
    const branchRes = await client.query(
      "INSERT INTO branches (organization_id, name, city) VALUES ($1, 'الفرع الرئيسي', NULL) RETURNING id",
      [orgId]
    );
    const hash = await bcrypt.hash(password, 12);
    const result = await client.query(
      `INSERT INTO users (organization_id, name, role, branch_id, email, password_hash)
       VALUES ($1,$2,'admin',$3,$4,$5) RETURNING id, organization_id, name, role, branch_id, email`,
      [orgId, name, branchRes.rows[0].id, email, hash]
    );
    const user = result.rows[0];
    const { token } = await finishAuthentication(client, user, req, "account_registered");
    await client.query("COMMIT");
    setAuthCookie(res, token, SESSION_TTL_HOURS);
    res.json({ user: publicUser(user), organizationCode: newOrganizationCode });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "register_failed" });
  } finally {
    client.release();
  }
});

/** Email is unique only within a tenant; organizationCode is mandatory. */
router.post("/login", async (req, res) => {
  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const organizationCode = String(body.organizationCode || "").trim().toUpperCase();
  if (!email || !password || !organizationCode) return res.status(400).json({ error: "missing_login_fields" });
  if (email.length > 254 || password.length > 128 || organizationCode.length > 32) {
    return res.status(400).json({ error: "invalid_login_fields" });
  }

  const subjectHash = loginSubjectHash(email, organizationCode);
  // Block the abusive source/account pair, not the whole account. This avoids
  // letting an attacker deliberately lock a known employee out from elsewhere.
  const { ipHash } = requestSecurityContext(req);
  const guardHash = securityHash(`login-attempt\n${subjectHash}\n${ipHash}`);
  try {
    const blockedUntil = await checkLoginGuard(pool, guardHash);
    if (blockedUntil) {
      await recordSecurityEvent(pool, {
        req,
        subjectHash,
        eventType: "login_blocked",
        outcome: "blocked",
        severity: "high",
      });
      res.setHeader("Retry-After", String(Math.max(1, Math.ceil((new Date(blockedUntil) - new Date()) / 1000))));
      return res.status(429).json({ error: "login_temporarily_blocked" });
    }

    const result = await pool.query(
      `SELECT u.* FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE lower(u.email) = $1 AND upper(o.login_code) = $2`,
      [email, organizationCode]
    );
    const user = result.rows[0];
    // Always run bcrypt, including for unknown accounts, to reduce timing-based
    // account discovery. The public error remains deliberately generic.
    const ok = await bcrypt.compare(password, user?.password_hash || DUMMY_PASSWORD_HASH);
    if (!user || !user.password_hash || !ok) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const guard = await recordLoginFailure(client, guardHash, user?.organization_id || null);
        await recordSecurityEvent(client, {
          req,
          organizationId: user?.organization_id || null,
          userId: user?.id || null,
          subjectHash,
          eventType: guard.blocked_until ? "login_blocked" : "login_failed",
          outcome: guard.blocked_until ? "blocked" : "failure",
          severity: guard.blocked_until ? "high" : "warning",
          metadata: { failure_count: guard.failure_count },
        });
        await client.query("COMMIT");
        if (guard.blocked_until) res.setHeader("Retry-After", String(LOGIN_LOCK_MINUTES * 60));
        return res.status(guard.blocked_until ? 429 : 401).json({
          error: guard.blocked_until ? "login_temporarily_blocked" : "invalid_credentials",
        });
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await clearLoginGuard(client, guardHash);
      const { token } = await finishAuthentication(client, user, req, "login_succeeded");
      await client.query("COMMIT");
      setAuthCookie(res, token, SESSION_TTL_HOURS);
      res.json({ user: publicUser(user) });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "login_failed" });
  }
});

/** Creates an account from a one-time invitation. */
router.post("/accept-invitation", async (req, res) => {
  const body = req.body || {};
  const invitationToken = String(body.token || "");
  const name = String(body.name || "").trim();
  const password = String(body.password || "");
  if (!invitationToken || invitationToken.length > 100 || !name || name.length > 120 || !isAcceptablePassword(password)) {
    return res.status(400).json({ error: "invalid_invitation_signup" });
  }
  const tokenHash = crypto.createHash("sha256").update(invitationToken).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT * FROM organization_invites
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [tokenHash]
    );
    const invite = inviteResult.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "invitation_invalid_or_expired" });
    }
    const existing = await client.query(
      "SELECT id FROM users WHERE organization_id = $1 AND lower(email) = lower($2)",
      [invite.organization_id, invite.email]
    );
    if (existing.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "email_taken" });
    }
    const hash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (organization_id, name, role, branch_id, email, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, organization_id, name, role, branch_id, email`,
      [invite.organization_id, name, invite.role, invite.branch_id, invite.email, hash]
    );
    await client.query("UPDATE organization_invites SET used_at = now() WHERE id = $1", [invite.id]);
    const user = userResult.rows[0];
    const { token } = await finishAuthentication(client, user, req, "invitation_accepted");
    await client.query("COMMIT");
    setAuthCookie(res, token, SESSION_TTL_HOURS);
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "invitation_accept_failed" });
  } finally {
    client.release();
  }
});

router.get("/me", authRequired, async (req, res) => {
  const result = await pool.query(
    `SELECT id, organization_id, name, role, branch_id, email
     FROM users WHERE id = $1 AND organization_id = $2`,
    [req.user.id, req.user.organizationId]
  );
  const row = result.rows[0];
  if (!row) return res.status(401).json({ error: "user_not_found" });
  res.json({ user: publicUser(row) });
});

router.put("/me", authRequired, async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name || name.length > 120) return res.status(400).json({ error: "name_required" });
  try {
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2 AND organization_id = $3
       RETURNING id, organization_id, name, role, branch_id, email`,
      [name, req.user.id, req.user.organizationId]
    );
    if (!result.rows[0]) return res.status(404).json({ error: "user_not_found" });
    await recordSecurityEvent(pool, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "profile_changed",
      outcome: "success",
    });
    res.json({ user: publicUser(result.rows[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "update_failed" });
  }
});

router.put("/password", authRequired, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!currentPassword || currentPassword.length > 128 || !isAcceptablePassword(newPassword)) {
    return res.status(400).json({ error: "invalid_password_change" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT password_hash FROM users
       WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
      [req.user.id, req.user.organizationId]
    );
    const passwordHash = result.rows[0]?.password_hash;
    const currentMatches = passwordHash && await bcrypt.compare(currentPassword, passwordHash);
    if (!currentMatches) {
      await recordSecurityEvent(client, {
        req,
        organizationId: req.user.organizationId,
        userId: req.user.id,
        sessionId: req.user.sid,
        eventType: "password_change_failed",
        outcome: "failure",
        severity: "warning",
      });
      await client.query("COMMIT");
      return res.status(401).json({ error: "current_password_invalid" });
    }
    if (await bcrypt.compare(newPassword, passwordHash)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "new_password_must_differ" });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await client.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2 AND organization_id = $3",
      [newHash, req.user.id, req.user.organizationId]
    );
    const revoked = await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'credentials_changed'
       WHERE organization_id = $1 AND user_id = $2 AND id <> $3::uuid
         AND revoked_at IS NULL AND expires_at > now()`,
      [req.user.organizationId, req.user.id, req.user.sid]
    );
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "password_changed",
      outcome: "success",
      severity: "warning",
      metadata: { revoked_sessions: revoked.rowCount },
    });
    await client.query("COMMIT");
    res.json({ ok: true, revokedSessions: revoked.rowCount });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.get("/sessions", authRequired, async (req, res) => {
  const result = await pool.query(
    `SELECT id, created_at, last_seen_at, expires_at, revoked_at,
            (id = $1::uuid) AS current
     FROM user_sessions
     WHERE organization_id = $2 AND user_id = $3 AND expires_at > now()
     ORDER BY created_at DESC LIMIT 50`,
    [req.user.sid, req.user.organizationId, req.user.id]
  );
  res.json({ sessions: result.rows });
});

router.delete("/sessions/:id", authRequired, async (req, res) => {
  const sessionId = String(req.params.id || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    return res.status(400).json({ error: "invalid_session_id" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'user_revoked'
       WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, req.user.organizationId, req.user.id]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "session_not_found" });
    }
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId,
      eventType: "session_revoked",
      outcome: "success",
      severity: sessionId === req.user.sid ? "warning" : "info",
    });
    await client.query("COMMIT");
    const currentSessionRevoked = sessionId === req.user.sid;
    if (currentSessionRevoked) clearAuthCookie(res);
    res.json({ ok: true, currentSessionRevoked });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.post("/logout", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "session_revoked",
      outcome: "success",
    });
    await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'logout'
       WHERE id = $1 AND organization_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
      [req.user.sid, req.user.organizationId, req.user.id]
    );
    await client.query("COMMIT");
    clearAuthCookie(res);
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

router.post("/sessions/revoke-others", authRequired, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE user_sessions SET revoked_at = now(), revoked_reason = 'security_response'
       WHERE organization_id = $1 AND user_id = $2 AND id <> $3::uuid
         AND revoked_at IS NULL AND expires_at > now()`,
      [req.user.organizationId, req.user.id, req.user.sid]
    );
    await recordSecurityEvent(client, {
      req,
      organizationId: req.user.organizationId,
      userId: req.user.id,
      sessionId: req.user.sid,
      eventType: "all_sessions_revoked",
      outcome: "success",
      severity: "warning",
      metadata: { revoked_count: result.rowCount },
    });
    await client.query("COMMIT");
    res.json({ ok: true, revokedCount: result.rowCount });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
});

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
  const token = readAuthCookie(req) || bearerToken;
  if (!token) return res.status(401).json({ error: "no_token" });
  if (token.length > 4096) return res.status(401).json({ error: "invalid_token" });
  try {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    if (!claims.sid || !claims.id || !claims.organizationId) {
      return res.status(401).json({ error: "session_required" });
    }
    const result = await pool.query(
      `UPDATE user_sessions s SET last_seen_at = now()
       FROM users u
       WHERE s.id = $1::uuid AND s.user_id = $2 AND s.organization_id = $3
         AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.id = s.user_id AND u.organization_id = s.organization_id
         AND u.role = $4
         AND u.branch_id IS NOT DISTINCT FROM $5::integer
       RETURNING u.role, u.branch_id`,
      [claims.sid, claims.id, claims.organizationId, claims.role, claims.branchId ?? null]
    );
    const active = result.rows[0];
    if (!active) return res.status(401).json({ error: "session_inactive" });
    req.user = { ...claims, role: active.role, branchId: active.branch_id };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({ error: "forbidden" });
    next();
  };
}

export function subscriptionAllowsAccess(subscriptionStatus, trialEndsAt, now = new Date()) {
  if (subscriptionStatus === "active") return true;
  return subscriptionStatus === "trialing" && trialEndsAt && new Date(trialEndsAt) > now;
}

export async function requireActiveSubscription(req, res, next) {
  try {
    const result = await pool.query(
      "SELECT subscription_status, trial_ends_at FROM organizations WHERE id = $1",
      [req.user.organizationId]
    );
    const organization = result.rows[0];
    if (!organization || !subscriptionAllowsAccess(organization.subscription_status, organization.trial_ends_at)) {
      return res.status(402).json({ error: "subscription_required" });
    }
    next();
  } catch (err) {
    console.error(err);
    res.status(503).json({ error: "subscription_check_failed" });
  }
}

export default router;
