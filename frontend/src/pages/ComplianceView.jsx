import React, { useEffect, useState } from "react";
import { getComplianceStatus } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const BLOCKERS = {
  vat_identity_missing: ["الرقم الضريبي غير مكتمل", "VAT identity is incomplete"],
  commercial_registration_missing: ["رقم السجل التجاري غير مكتمل", "Commercial registration is incomplete"],
  approved_signing_module_missing: ["وحدة توقيع UBL معتمدة غير متوفرة", "Approved UBL signing module is missing"],
  zatca_transport_disabled: ["اتصال ZATCA متوقف افتراضيًا", "ZATCA transport is disabled by default"],
  zatca_credentials_missing: ["بيانات اعتماد فاتورة غير مضبوطة في مخزن الأسرار", "FATOORA credentials are not in the secret store"],
  zatca_credential_tenant_mismatch: ["بيانات اعتماد فاتورة غير مربوطة بهذه المنشأة", "FATOORA credentials are not bound to this organization"],
  zatca_production_approval_missing: ["اعتماد تشغيل الإنتاج غير مسجل", "Production approval is not recorded"],
};

function StatusCard({ title, ok, children }) {
  return (
    <section className="rk-card" style={{ padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <span style={{ fontWeight: 800, color: ok ? "#15803d" : "#b45309" }}>{ok ? "●" : "●"}</span>
      </div>
      {children}
    </section>
  );
}

export default function ComplianceView() {
  const { lang, t } = useLanguage();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getComplianceStatus().then((result) => {
      if (result?.error) setError(t("compliance_load_error"));
      else setData(result);
    }).catch(() => setError(t("compliance_load_error")));
  }, [t]);

  if (error) return <div className="rk-alert rk-alert-danger">{error}</div>;
  if (!data) return <p>{t("loading")}</p>;
  const phase2Ready = data.zatca.phase2 === "transport_ready";

  return (
    <main>
      <div className="rk-page-heading">
        <div><h2>{t("compliance_title")}</h2><p>{t("compliance_subtitle")}</p></div>
        <span className="rk-badge">{t("compliance_admin_only")}</span>
      </div>
      <div className="rk-alert" style={{ marginBottom: 16 }}>{t("compliance_no_certification_claim")}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 }}>
        <StatusCard title={t("compliance_zatca_title")} ok={phase2Ready}>
          <p>{t("compliance_phase1")}: <b>{t("compliance_implemented")}</b></p>
          <p>{t("compliance_phase2")}: <b>{phase2Ready ? t("compliance_transport_ready") : t("compliance_not_ready")}</b></p>
          <p>{t("compliance_environment")}: <b>{data.zatca.environment}</b></p>
        </StatusCard>
        <StatusCard title={t("compliance_security_title")} ok={Number(data.security.high_7d || 0) === 0}>
          <p>{t("compliance_denied_24h")}: <b>{data.security.denied_24h}</b></p>
          <p>{t("compliance_high_7d")}: <b>{data.security.high_7d}</b></p>
          <p>{t("compliance_raw_payload")}: <b>{t("compliance_not_stored")}</b></p>
        </StatusCard>
        <StatusCard title={t("compliance_identity_title")} ok={data.organization.vatReady && data.organization.commercialRegistrationReady}>
          <p>{t("compliance_vat")}: <b>{data.organization.vatReady ? "✓" : "—"}</b></p>
          <p>{t("compliance_cr")}: <b>{data.organization.commercialRegistrationReady ? "✓" : "—"}</b></p>
          <p>{t("compliance_tenant_isolation")}: <b>✓</b></p>
        </StatusCard>
      </div>
      <section className="rk-card" style={{ marginTop: 16, padding: 16 }}>
        <h3>{t("compliance_blockers")}</h3>
        {data.zatca.blockers.length === 0 ? <p>{t("compliance_no_blockers")}</p> : (
          <ol>{data.zatca.blockers.map((item) => <li key={item}>{BLOCKERS[item]?.[lang === "ar" ? 0 : 1] || item}</li>)}</ol>
        )}
      </section>
      <section className="rk-card" style={{ marginTop: 16, padding: 16 }}>
        <h3>{t("compliance_attempts")}</h3>
        {data.attempts.length === 0 ? <p>{t("compliance_no_attempts")}</p> : (
          <table width="100%"><thead><tr><th>{t("compliance_time")}</th><th>{t("compliance_environment")}</th><th>{t("status_label")}</th></tr></thead>
            <tbody>{data.attempts.map((attempt) => <tr key={attempt.id}><td>{new Date(attempt.created_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-GB")}</td><td>{attempt.environment}</td><td>{attempt.status}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </main>
  );
}
