import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../db/pool.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  // Security fix: never silently fall back to a hardcoded default secret —
  // that would let anyone who reads the source code forge valid tokens.
  // Fail loudly at startup instead, so a misconfigured deployment is caught
  // immediately rather than running insecurely in production.
  throw new Error(
    "JWT_SECRET is missing or too short. Set a strong random value (32+ chars) in your .env file."
  );
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
  if (role !== "admin" && !organizationId) {
    return res.status(400).json({ error: "missing_organization" });
  }
  // Security fix: creating an "admin" for an EXISTING organization must never
  // be possible through public self-signup — that would let anyone become an
  // admin of someone else's shop just by knowing/guessing its organizationId.
  // Admins may only be created via the new-tenant bootstrap flow below
  // (role="admin" with NO organizationId). Adding a second admin to an
  // existing org must go through an authenticated invite flow, not this route.
  if (role === "admin" && organizationId) {
    return res.status(403).json({ error: "admin_signup_requires_new_organization" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let orgId = organizationId;

    if (role === "admin" && !organizationId) {
      if (!businessName) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "missing_business_name" });
      }
      const orgRes = await client.query(
        `INSERT INTO organizations (name, plan, subscription_status, trial_ends_at)
         VALUES ($1, 'professional', 'trialing', now() + interval '14 days') RETURNING id`,
        [businessName]
      );
      orgId = orgRes.rows[0].id;

      // give the new tenant one default branch so the app isn't empty on first login
      const branchRes = await client.query(
        `INSERT INTO branches (organization_id, name, city) VALUES ($1, 'الفرع الرئيسي', NULL) RETURNING id`,
        [orgId]
      );
      req._defaultBranchId = branchRes.rows[0].id;
    } else {
      const orgCheck = await client.query("SELECT id FROM organizations WHERE id = $1", [orgId]);
      if (!orgCheck.rows.length) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "organization_not_found" });
      }
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
    res.json({ user, token });
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
  const { email, password, organizationId } = req.body;
  try {
    let user;
    if (organizationId) {
      const result = await pool.query(
        "SELECT * FROM users WHERE email = $1 AND organization_id = $2",
        [email, organizationId]
      );
      user = result.rows[0];
    } else {
      // Security/correctness fix: an email can exist in multiple tenants.
      // Silently picking the first match (ORDER BY id LIMIT 1) could log a
      // user into the WRONG organization's account. If the email is
      // ambiguous, ask the client to disambiguate instead of guessing.
      const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
      if (result.rows.length > 1) {
        return res.status(409).json({
          error: "ambiguous_email",
          organizations: result.rows.map((r) => r.organization_id),
        });
      }
      user = result.rows[0];
    }
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

/** GET /api/auth/me — requires Authorization: Bearer <token> */
router.get("/me", authRequired, async (req, res) => {
  res.json({ user: req.user });
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

export default router;
