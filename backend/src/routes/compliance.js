import { pool } from "../db/pool.js";
import { createSafeRouter } from "../utils/safe-router.js";
import {
  getZatcaConfiguration,
  reportSignedInvoice,
  signedInvoiceMatchesOrganization,
  validateSignedInvoicePackage,
} from "../utils/zatca-integration.js";

const router = createSafeRouter();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function publicConfiguration(configuration) {
  return {
    enabled: configuration.enabled,
    environment: configuration.environment,
    credentialsConfigured: configuration.credentialsConfigured,
    productionApproved: configuration.productionApproved,
    transportReady: configuration.transportReady,
  };
}

function readinessBlockers(org, configuration) {
  const blockers = [];
  const organizationId = Number(org?.organization_id ?? org?.id);
  if (!/^\d{15}$/.test(String(org?.vat_number || ""))) blockers.push("vat_identity_missing");
  if (!/^\d{10}$/.test(String(org?.commercial_registration_number || ""))) blockers.push("commercial_registration_missing");
  if (process.env.ZATCA_SIGNING_MODULE_APPROVED !== "true") blockers.push("approved_signing_module_missing");
  if (configuration.organizationId !== organizationId) blockers.push("zatca_credential_tenant_mismatch");
  if (!configuration.enabled) blockers.push("zatca_transport_disabled");
  else if (!configuration.credentialsConfigured) blockers.push("zatca_credentials_missing");
  else if (configuration.environment === "production" && !configuration.productionApproved) {
    blockers.push("zatca_production_approval_missing");
  }
  return blockers;
}

router.get("/status", async (req, res) => {
  const orgId = req.user.organizationId;
  const [organizationResult, invoiceResult, securityResult, attemptsResult] = await Promise.all([
    pool.query(
      `SELECT id, name, vat_number, commercial_registration_number
       FROM organizations WHERE id = $1`,
      [orgId]
    ),
    pool.query(
      `SELECT
         count(*)::integer AS total,
         count(*) FILTER (WHERE zatca_status = 'generated_locally')::integer AS local_qr,
         count(*) FILTER (WHERE zatca_status IN ('reported','submitted'))::integer AS reported,
         count(*) FILTER (WHERE zatca_status = 'rejected')::integer AS rejected
       FROM invoices WHERE organization_id = $1`,
      [orgId]
    ),
    pool.query(
      `SELECT
         count(*) FILTER (WHERE occurred_at >= now() - interval '24 hours')::integer AS events_24h,
         count(*) FILTER (WHERE occurred_at >= now() - interval '24 hours' AND outcome IN ('failure','blocked'))::integer AS denied_24h,
         count(*) FILTER (WHERE occurred_at >= now() - interval '7 days' AND severity IN ('high','critical'))::integer AS high_7d,
         max(occurred_at) FILTER (WHERE severity IN ('high','critical')) AS last_high_at
       FROM security_events WHERE organization_id = $1`,
      [orgId]
    ),
    pool.query(
      `SELECT id, invoice_id, environment, operation, status, http_status,
              provider_status, warning_count, error_count, created_at, completed_at
       FROM government_integration_attempts
       WHERE organization_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    ),
  ]);
  const organization = organizationResult.rows[0];
  if (!organization) return res.status(404).json({ error: "organization_not_found" });
  const configuration = getZatcaConfiguration();
  const blockers = readinessBlockers(organization, configuration);
  res.json({
    organization: {
      legalNameReady: Boolean(organization.name),
      vatReady: /^\d{15}$/.test(String(organization.vat_number || "")),
      commercialRegistrationReady: /^\d{10}$/.test(String(organization.commercial_registration_number || "")),
    },
    controls: {
      tenantIsolation: true,
      browserDatabaseAccessBlocked: true,
      revocableSessions: true,
      appendOnlySecurityEvidence: true,
      outboundAllowlist: true,
      rawIntegrationPayloadStored: false,
    },
    zatca: {
      phase1Qr: "implemented",
      phase2: blockers.length === 0 ? "transport_ready" : "not_ready",
      signingModuleApproved: process.env.ZATCA_SIGNING_MODULE_APPROVED === "true",
      ...publicConfiguration(configuration),
      credentialTenantBound: configuration.organizationId === Number(organization.id),
      blockers,
      invoiceCounts: invoiceResult.rows[0],
    },
    security: securityResult.rows[0],
    attempts: attemptsResult.rows,
  });
});

router.post("/zatca/invoices/:invoiceId/report", async (req, res) => {
  if (process.env.ZATCA_SIGNING_MODULE_APPROVED !== "true") {
    return res.status(503).json({ error: "approved_signing_module_required" });
  }
  const invoiceId = Number(req.params.invoiceId);
  const requestReference = String(req.body?.requestReference || "");
  if (!Number.isInteger(invoiceId) || invoiceId < 1 || !UUID_PATTERN.test(requestReference)) {
    return res.status(400).json({ error: "invalid_zatca_reporting_request" });
  }
  const validated = validateSignedInvoicePackage(req.body);
  if (validated.error) return res.status(400).json({ error: validated.error });

  const orgId = req.user.organizationId;
  const invoiceResult = await pool.query(
    `SELECT i.id, i.organization_id, i.zatca_status, i.zatca_uuid, i.zatca_document_hash, o.vat_number,
            o.commercial_registration_number
     FROM invoices i JOIN organizations o ON o.id = i.organization_id
     WHERE i.id = $1 AND i.organization_id = $2`,
    [invoiceId, orgId]
  );
  const invoice = invoiceResult.rows[0];
  if (!invoice) return res.status(404).json({ error: "invoice_not_found" });
  const configuration = getZatcaConfiguration();
  const blockers = readinessBlockers(invoice, configuration);
  if (blockers.length) return res.status(503).json({ error: "zatca_not_ready", blockers });
  if (!signedInvoiceMatchesOrganization(validated.value, invoice.vat_number)) {
    return res.status(400).json({ error: "zatca_invoice_identity_mismatch" });
  }
  if (
    invoice.zatca_uuid &&
    (String(invoice.zatca_uuid) !== validated.value.invoiceUuid || invoice.zatca_document_hash !== validated.value.documentHash)
  ) {
    return res.status(409).json({ error: "invoice_already_bound_to_another_zatca_document" });
  }

  const prior = await pool.query(
    `SELECT id, invoice_id, document_hash, status, created_at
     FROM government_integration_attempts
     WHERE organization_id = $1 AND provider = 'zatca' AND request_reference = $2`,
    [orgId, requestReference]
  );
  if (prior.rows[0]) {
    if (Number(prior.rows[0].invoice_id) !== invoiceId || prior.rows[0].document_hash !== validated.value.documentHash) {
      return res.status(409).json({ error: "zatca_request_reference_conflict" });
    }
    if (prior.rows[0].status === "reported") return res.json({ ok: true, idempotent: true });
    return res.status(409).json({ error: "zatca_attempt_requires_review", status: prior.rows[0].status });
  }

  let inserted;
  try {
    inserted = await pool.query(
      `INSERT INTO government_integration_attempts
         (organization_id, invoice_id, provider, environment, operation, request_reference,
          document_hash, document_bytes, status)
       VALUES ($1,$2,'zatca',$3,'reporting',$4,$5,$6,'processing') RETURNING id`,
      [orgId, invoiceId, configuration.environment, requestReference, validated.value.documentHash, validated.value.documentBytes]
    );
  } catch (error) {
    if (error?.code === "23505") {
      return res.status(409).json({ error: "zatca_invoice_submission_in_progress_or_completed" });
    }
    throw error;
  }
  try {
    const result = await reportSignedInvoice(validated.value, orgId);
    const reported = result.ok && /reported/i.test(result.reportingStatus);
    const status = reported ? "reported" : "rejected";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE government_integration_attempts SET status = $1, http_status = $2,
           provider_status = $3, warning_count = $4, error_count = $5, completed_at = now()
         WHERE id = $6 AND organization_id = $7`,
        [status, result.httpStatus, result.reportingStatus || null, result.warnings.length, result.errors.length, inserted.rows[0].id, orgId]
      );
      await client.query(
        `UPDATE invoices SET zatca_status = $1, zatca_uuid = $2, zatca_document_hash = $3
         WHERE id = $4 AND organization_id = $5`,
        [status, validated.value.invoiceUuid, validated.value.documentHash, invoiceId, orgId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    return res.status(reported ? 200 : 422).json({
      ok: reported,
      status,
      providerStatus: result.reportingStatus,
      warningCount: result.warnings.length,
      errorCount: result.errors.length,
    });
  } catch (error) {
    // Once a POST is attempted, a network failure cannot prove that ZATCA did
    // not receive it. Fail into manual review and keep the partial unique index
    // locked so a new request reference cannot duplicate the same invoice.
    const failureStatus = "manual_review";
    const errorCode = "zatca_reconciliation_required";
    await pool.query(
      `UPDATE government_integration_attempts SET status = $1,
         error_code = $2, completed_at = now()
       WHERE id = $3 AND organization_id = $4 AND status = 'processing'`,
      [failureStatus, errorCode, inserted.rows[0].id, orgId]
    ).catch(() => {});
    console.error("ZATCA reconciliation required", {
      requestId: req.requestId,
      attemptId: inserted.rows[0].id,
      message: errorCode,
    });
    return res.status(503).json({ error: errorCode });
  }
});

export default router;
