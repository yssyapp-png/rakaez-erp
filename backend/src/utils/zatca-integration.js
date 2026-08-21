import crypto from "crypto";
import { secureOutboundFetch } from "./outbound-policy.js";

const ZATCA_ORIGIN = "https://gw-fatoora.zatca.gov.sa";
const ZATCA_REPORTING_ENDPOINTS = Object.freeze({
  simulation: `${ZATCA_ORIGIN}/e-invoicing/simulation/invoices/reporting/single`,
  production: `${ZATCA_ORIGIN}/e-invoicing/core/invoices/reporting/single`,
});
const MAX_SIGNED_INVOICE_BYTES = 1_500_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function strictBase64(value, expectedBytes = null) {
  const input = String(value || "").trim();
  if (!input || input.length % 4 !== 0 || !BASE64_PATTERN.test(input)) return null;
  const decoded = Buffer.from(input, "base64");
  if (expectedBytes !== null && decoded.length !== expectedBytes) return null;
  if (decoded.toString("base64") !== input) return null;
  return decoded;
}

export function getZatcaConfiguration(env = process.env) {
  const environment = env.ZATCA_ENVIRONMENT === "production" ? "production" : "simulation";
  const enabled = env.ZATCA_INTEGRATION_ENABLED === "true";
  const parsedOrganizationId = Number(env.ZATCA_ORGANIZATION_ID);
  const organizationId = Number.isInteger(parsedOrganizationId) && parsedOrganizationId > 0
    ? parsedOrganizationId
    : null;
  const credentialsConfigured = Boolean(env.ZATCA_BINARY_SECURITY_TOKEN && env.ZATCA_SECRET);
  const productionApproved = env.ZATCA_PRODUCTION_APPROVED === "true";
  return {
    enabled,
    environment,
    organizationId,
    credentialsConfigured,
    productionApproved,
    endpoint: ZATCA_REPORTING_ENDPOINTS[environment],
    transportReady: enabled && organizationId !== null && credentialsConfigured && (environment !== "production" || productionApproved),
  };
}

export function validateZatcaRuntimeConfiguration(env = process.env) {
  const configuration = getZatcaConfiguration(env);
  if (!configuration.enabled) return configuration;
  if (!env.ZATCA_BINARY_SECURITY_TOKEN || !env.ZATCA_SECRET) {
    throw new Error("ZATCA credentials are required when the integration is enabled");
  }
  if (configuration.organizationId === null) {
    throw new Error("ZATCA_ORGANIZATION_ID must bind the credentials to one Rakaez organization");
  }
  if (!env.ZATCA_ENVIRONMENT || !Object.hasOwn(ZATCA_REPORTING_ENDPOINTS, env.ZATCA_ENVIRONMENT)) {
    throw new Error("ZATCA_ENVIRONMENT must be simulation or production");
  }
  if (configuration.environment === "production" && !configuration.productionApproved) {
    throw new Error("ZATCA_PRODUCTION_APPROVED must be true before production reporting is enabled");
  }
  return configuration;
}

export function validateSignedInvoicePackage(input) {
  if (!UUID_PATTERN.test(String(input?.invoiceUuid || ""))) {
    return { error: "invalid_zatca_invoice_uuid" };
  }
  const invoiceHash = strictBase64(input?.invoiceHash, 32);
  if (!invoiceHash) return { error: "invalid_zatca_invoice_hash" };

  const invoiceBytes = strictBase64(input?.invoiceBase64);
  if (!invoiceBytes || invoiceBytes.length > MAX_SIGNED_INVOICE_BYTES) {
    return { error: "invalid_zatca_invoice_document" };
  }
  const xml = invoiceBytes.toString("utf8");
  if (
    /<!DOCTYPE|<!ENTITY/i.test(xml) ||
    !/<(?:[A-Za-z0-9_-]+:)?Invoice\b/.test(xml) ||
    !/urn:oasis:names:specification:ubl:schema:xsd:Invoice-2/.test(xml) ||
    !/<(?:[A-Za-z0-9_-]+:)?InvoiceTypeCode\b[^>]*\bname\s*=\s*["']0200000["'][^>]*>\s*388\s*<\/(?:[A-Za-z0-9_-]+:)?InvoiceTypeCode>/i.test(xml)
  ) {
    return { error: "invalid_zatca_invoice_document" };
  }
  return {
    value: {
      invoiceUuid: String(input.invoiceUuid).toLowerCase(),
      invoiceHash: String(input.invoiceHash).trim(),
      invoiceBase64: String(input.invoiceBase64).trim(),
      documentHash: crypto.createHash("sha256").update(invoiceBytes).digest("hex"),
      documentBytes: invoiceBytes.length,
    },
  };
}

export function signedInvoiceMatchesOrganization(packageValue, vatNumber) {
  const xml = Buffer.from(packageValue?.invoiceBase64 || "", "base64").toString("utf8");
  const supplier = xml.match(/<(?:[A-Za-z0-9_-]+:)?AccountingSupplierParty\b[^>]*>([\s\S]{1,30000}?)<\/(?:[A-Za-z0-9_-]+:)?AccountingSupplierParty>/i)?.[1] || "";
  const vatMatch = supplier.match(/<(?:[A-Za-z0-9_-]+:)?CompanyID\b[^>]*>\s*([0-9]{15})\s*<\/(?:[A-Za-z0-9_-]+:)?CompanyID>/i);
  const uuidMatch = xml.match(/<(?:[A-Za-z0-9_-]+:)?UUID\b[^>]*>\s*([0-9a-f-]{36})\s*<\/(?:[A-Za-z0-9_-]+:)?UUID>/i);
  return Boolean(
    vatMatch &&
    uuidMatch &&
    vatMatch[1] === String(vatNumber || "") &&
    uuidMatch[1].toLowerCase() === packageValue.invoiceUuid
  );
}

function basicAuthorization(token, secret) {
  return `Basic ${Buffer.from(`${token}:${secret}`).toString("base64")}`;
}

function safeValidationMessages(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 50).map((item) => ({
    type: String(item?.type || "").slice(0, 40),
    code: String(item?.code || "").slice(0, 100),
    category: String(item?.category || "").slice(0, 100),
    message: String(item?.message || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500),
    status: String(item?.status || "").slice(0, 40),
  }));
}

function sanitizeProviderResponse(data) {
  const validation = data?.validationResults || {};
  return {
    reportingStatus: String(data?.reportingStatus || data?.status || "").slice(0, 80),
    warnings: safeValidationMessages(validation.warningMessages || data?.warnings),
    errors: safeValidationMessages(validation.errorMessages || data?.errors),
  };
}

/**
 * Sends an already generated and cryptographically signed simplified UBL
 * invoice to the official FATOORA reporting endpoint. It deliberately does
 * not create or export a signing key: that key belongs in a non-exportable
 * secure signing component, as required by ZATCA.
 */
export async function reportSignedInvoice(packageValue, organizationId, env = process.env) {
  const configuration = validateZatcaRuntimeConfiguration(env);
  if (!configuration.transportReady) throw new Error("zatca_transport_not_ready");
  if (configuration.organizationId !== Number(organizationId)) {
    throw new Error("zatca_credential_tenant_mismatch");
  }

  const response = await secureOutboundFetch(configuration.endpoint, {
    allowedOrigins: [ZATCA_ORIGIN],
    timeoutMs: env.ZATCA_TIMEOUT_MS,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "Accept-Version": "V2",
      "Content-Type": "application/json",
      Authorization: basicAuthorization(env.ZATCA_BINARY_SECURITY_TOKEN, env.ZATCA_SECRET),
    },
    body: JSON.stringify({
      invoiceHash: packageValue.invoiceHash,
      uuid: packageValue.invoiceUuid,
      invoice: packageValue.invoiceBase64,
    }),
  });

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 1_000_000) throw new Error("zatca_response_too_large");
  const text = await response.text();
  if (text.length > 1_000_000) throw new Error("zatca_response_too_large");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return {
    ok: response.ok,
    httpStatus: response.status,
    ...sanitizeProviderResponse(data),
  };
}
