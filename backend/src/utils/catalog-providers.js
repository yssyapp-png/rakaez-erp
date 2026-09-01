const PROVIDER_DEFINITIONS = Object.freeze({
  "7zap-levam": Object.freeze({
    id: "7zap-levam",
    name: "7zap / Levam",
    purpose: "vin_oem_catalog",
    capabilities: Object.freeze(["vin_decode", "oem_catalog", "diagrams", "applicability"]),
    publicWebsite: "https://7zap.com/",
    requiredEnvironment: Object.freeze({
      enabled: "CATALOG_7ZAP_LEVAM_ENABLED",
      licenseApproved: "CATALOG_7ZAP_LEVAM_LICENSE_APPROVED",
      apiKey: "LEVAM_API_KEY",
    }),
  }),
  partsouq: Object.freeze({
    id: "partsouq",
    name: "PartSouq",
    purpose: "supplier_price_availability",
    capabilities: Object.freeze(["vin_frame_search", "oem_catalog", "price", "availability"]),
    publicWebsite: "https://partsouq.com/",
    requiredEnvironment: Object.freeze({
      enabled: "CATALOG_PARTSOUQ_ENABLED",
      licenseApproved: "CATALOG_PARTSOUQ_LICENSE_APPROVED",
      apiKey: "PARTSOUQ_API_KEY",
    }),
  }),
});

function enabled(value) {
  return String(value || "").toLowerCase() === "true";
}
function configuredStatus(definition, env) {
  const isEnabled = enabled(env[definition.requiredEnvironment.enabled]);
  const licenseApproved = enabled(env[definition.requiredEnvironment.licenseApproved]);
  const credentialsConfigured = Boolean(String(env[definition.requiredEnvironment.apiKey] || "").trim());

  let status = "disabled";
  if (isEnabled && !licenseApproved) status = "awaiting_license";
  else if (isEnabled && !credentialsConfigured) status = "awaiting_credentials";
  else if (isEnabled) status = "awaiting_connector_validation";

  return {
    id: definition.id,
    name: definition.name,
    purpose: definition.purpose,
    capabilities: [...definition.capabilities],
    publicWebsite: definition.publicWebsite,
    enabled: isEnabled,
    licenseApproved,
    credentialsConfigured,
    status,
  };
}

/**
 * Returns non-secret provider readiness metadata for the administrator UI.
 * No VIN, API key, endpoint override, or catalog response is exposed here.
 */
export function getCatalogProviderStatuses(env = process.env) {
  return Object.values(PROVIDER_DEFINITIONS).map((definition) => configuredStatus(definition, env));
}

/**
 * Fail closed if someone tries to enable a commercial provider before the
 * written licence and credentials exist. Network transport remains deliberately
 * absent until the vendor supplies its official API contract and test account.
 */
export function validateCatalogProviderConfiguration(env = process.env) {
  for (const provider of getCatalogProviderStatuses(env)) {
    if (!provider.enabled) continue;
    if (!provider.licenseApproved) {
      throw new Error(`${provider.id}_license_approval_required`);
    }
    if (!provider.credentialsConfigured) {
      throw new Error(`${provider.id}_api_key_required`);
    }
    throw new Error(`${provider.id}_connector_validation_required`);
  }
  return getCatalogProviderStatuses(env);
}
