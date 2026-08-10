import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { pool } from "../db/pool.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 characters");
}

/**
 * POST /api/auth/register
 * body: { name, email, password, role, branchId?, businessName?, organizationId? }
 *
 * Multi-tenant signup rules:
 *  - role "admin" with NO organizationId → this is a shop owner signing up
 *    for the first time. We create a brand-new organization (tenant) for
 *    them automatically, seeded with a trial subscription and one default
 *    branch, and make them its first admin. This is the self-signup flow
 *    the SaaS go-to-market plan depends on — no manual provisioning needed.
 *  - role "seller"/"customer" MUST pass an existing organizationId (their
 *    employer's or the shop's id) — they're joining a tenant, not creating
 *    one. Real deployments would replace this with an invite-link/shop-code
 *    flow instead of a raw id, but the isolation rule is what matters here.
 */
router.post("/register", async (req, res) => {
  const { name, email, password, role = "customer", branchId = null, businessName, organizationId } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "missing_fields" });
  }
  // Public registration creates a brand-new tenant owner only. Joining an
  // existing tenant must go through the authenticated invitation flow.
  if (role !== "admin" || organizationId || branchId) {
    return res.status(403).json({ error: "invitation_required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let orgId = organizationId;
    let newOrganizationCode;

    if (role === "admin") {
      if (!businessName) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "missing_business_name" });
      }
      const loginCode = `RKZ-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const orgRes = await client.query(
        `INSERT INTO organizations (name, login_code, plan, subscription_status, trial_ends_at)
         VALUES ($1, $2, 'professional', 'trialing', now() + interval '14 days') RETURNING id, login_code`,
        [businessName, loginCode]
      );
      orgId = orgRes.rows[0].id;
      newOrganizationCode = orgRes.rows[0].login_code;

      // give the new tenant one default branch so the app isn't empty on first login
      const branchRes = await client.query(
        `INSERT INTO branches (organization_id, name, city) VALUES ($1, 'الفرع الرئيسي', NULL) RETURNING id`,
        [orgId]
      );
      req._defaultBranchId = branchRes.rows[0].id;
    }

    const existing = await client.query(
      "SELECT id FROM users WHERE organization_id = $1 AND email = $2",
      [orgId, email]
    );
    if (existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "email_taken" });
    }

    const hash = await bcrypt.hash(password, 10);
    const finalBranchId = branchId || req._defaultBranchId || null;
    const result = await client.query(
      `INSERT INTO users (organization_id, name, role, branch_id, email, password_hash)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, organization_id, name, role, branch_id, email`,
      [orgId, name, role, finalBranchId, email, hash]
    );
    const user = result.rows[0];

    await client.query("COMMIT");

    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branch_id, organizationId: user.organization_id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ user, token, organizationCode: newOrganizationCode });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "register_failed" });
  } finally {
    client.release();
  }
});

/**
 * POST /api/auth/login
 * body: { email, password, organizationId? }
 * NOTE: because email is only unique WITHIN an organization now (two shops
 * can each have a "seller1@example.com"), a bare email/password isn't
 * enough to identify one account across the whole system. For this MVP we
 * resolve by taking the first matching account if organizationId isn't
 * given — fine for a single demo tenant, but a real multi-tenant launch
 * needs a shop-selection step (e.g. a subdomain per shop, or "which shop
 * do you work at?" screen) before login.
 */
router.post("/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const organizationCode = String(req.body.organizationCode || "").trim().toUpperCase();
  if (!email || !password || !organizationCode) {
    return res.status(400).json({ error: "missing_login_fields" });
  }
  try {
    const result = await pool.query(
      `SELECT u.* FROM users u
       JOIN organizations o ON o.id = u.organization_id
       WHERE lower(u.email) = $1 AND upper(o.login_code) = $2`,
      [email, organizationCode]
    );
    const user = result.rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    const token = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branch_id, organizationId: user.organization_id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
        branchId: user.branch_id,
        organizationId: user.organization_id,
        email: user.email,
      },
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "login_failed" });
  }
});

/** POST /api/auth/accept-invitation — creates an account from a one-time invite. */
router.post("/accept-invitation", async (req, res) => {
  const token = String(req.body.token || "");
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "");
  if (!token || !name || password.length < 8) {
    return res.status(400).json({ error: "invalid_invitation_signup" });
  }
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inviteResult = await client.query(
      `SELECT * FROM organization_invites
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
       FOR UPDATE`,
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
    await client.query("COMMIT");
    const user = userResult.rows[0];
    const jwtToken = jwt.sign(
      { id: user.id, role: user.role, branchId: user.branch_id, organizationId: user.organization_id },
      JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.status(201).json({ user, token: jwtToken });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "invitation_accept_failed" });
  } finally {
    client.release();
  }
});

/** GET /api/auth/me — requires Authorization: Bearer <token> */
router.get("/me", authRequired, async (req, res) => {
  const result = await pool.query(
    `SELECT id, organization_id, name, role, branch_id, email
     FROM users WHERE id = $1 AND organization_id = $2`,
    [req.user.id, req.user.organizationId]
  );
  const row = result.rows[0];
  if (!row) return res.status(401).json({ error: "user_not_found" });
  res.json({
    user: {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      role: row.role,
      branchId: row.branch_id,
      email: row.email,
    },
  });
});

/** PUT /api/auth/me — update the logged-in user's own name. */
router.put("/me", authRequired, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: "name_required" });
  }
  try {
    const result = await pool.query(
      `UPDATE users SET name = $1 WHERE id = $2 RETURNING id, name, role, branch_id, email`,
      [name.trim(), req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "user_not_found" });
    }
    const row = result.rows[0];
    const user = {
      id: row.id,
      name: row.name,
      role: row.role,
      branchId: row.branch_id,
      email: row.email,
      organizationId: req.user.organizationId,
    };
    // Reissue the token so the new name is reflected in future requests too.
    const token = jwt.sign(user, JWT_SECRET, { expiresIn: "30d" });
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "update_failed" });
  }
});

export function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "no_token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
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
