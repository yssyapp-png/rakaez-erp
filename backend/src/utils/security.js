import crypto from "crypto";

const DEVELOPMENT_PEPPER = "rakaez-local-security-event-pepper-2026";
const SECURITY_EVENT_PEPPER = process.env.SECURITY_EVENT_PEPPER || DEVELOPMENT_PEPPER;

export const LOGIN_FAILURE_LIMIT = 5;
export const LOGIN_FAILURE_WINDOW_MINUTES = 15;
export const LOGIN_LOCK_MINUTES = 15;

export function validateSecurityConfiguration({ nodeEnv, pepper }) {
  if (nodeEnv === "production" && (!pepper || pepper.length < 32)) {
    throw new Error("SECURITY_EVENT_PEPPER must be configured with at least 32 characters in production");
  }
}

validateSecurityConfiguration({ nodeEnv: process.env.NODE_ENV, pepper: process.env.SECURITY_EVENT_PEPPER });

export function securityHash(value) {
  return crypto
    .createHmac("sha256", SECURITY_EVENT_PEPPER)
    .update(String(value || ""))
    .digest("hex");
}

export function loginSubjectHash(email, organizationCode) {
  return securityHash(`${String(organizationCode || "").trim().toUpperCase()}\n${String(email || "").trim().toLowerCase()}`);
}

function safeMetadata(metadata) {
  const result = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!/^[a-z][a-z0-9_]{0,63}$/i.test(key)) continue;
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      result[key] = value;
    } else if (typeof value === "string") {
      result[key] = value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 200);
    }
  }
  return result;
}

export function requestSecurityContext(req) {
  const ip = req?.ip || req?.socket?.remoteAddress || "unknown";
  const userAgent = String(req?.headers?.["user-agent"] || "unknown").slice(0, 1000);
  return {
    ipHash: securityHash(ip),
    userAgentHash: securityHash(userAgent),
  };
}

export async function recordSecurityEvent(db, {
  req,
  organizationId = null,
  userId = null,
  sessionId = null,
  subjectHash = null,
  eventType,
  outcome,
  severity = "info",
  metadata = {},
}) {
  const { ipHash, userAgentHash } = requestSecurityContext(req);
  await db.query(
    `INSERT INTO security_events
       (organization_id, user_id, session_id, subject_hash, event_type, outcome, severity,
        request_id, ip_hash, user_agent_hash, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [
      organizationId,
      userId,
      sessionId,
      subjectHash,
      eventType,
      outcome,
      severity,
      req?.requestId || null,
      ipHash,
      userAgentHash,
      JSON.stringify(safeMetadata(metadata)),
    ]
  );
}
