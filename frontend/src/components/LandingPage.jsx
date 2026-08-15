import React from "react";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const FEATURE_KEYS = [
  ["01", "landing_feature_inventory_title", "landing_feature_inventory_body"],
  ["02", "landing_feature_parts_title", "landing_feature_parts_body"],
  ["03", "landing_feature_team_title", "landing_feature_team_body"],
  ["04", "landing_feature_vehicle_title", "landing_feature_vehicle_body"],
  ["05", "landing_feature_invoices_title", "landing_feature_invoices_body"],
  ["06", "landing_feature_security_title", "landing_feature_security_body"],
];

const WORKFLOW_KEYS = [
  ["1", "landing_step_one_title", "landing_step_one_body"],
  ["2", "landing_step_two_title", "landing_step_two_body"],
  ["3", "landing_step_three_title", "landing_step_three_body"],
];

export default function LandingPage({ onOpenLogin, onCreateShop }) {
  const { t } = useLanguage();

  return (
    <main className="rk-landing">
      <section className="rk-hero" aria-labelledby="landing-title">
        <div className="rk-hero-copy">
          <div className="rk-eyebrow"><span />{t("landing_eyebrow")}</div>
          <h1 id="landing-title">{t("landing_title")}</h1>
          <p>{t("landing_subtitle")}</p>
          <div className="rk-hero-actions">
            <button className="rk-btn rk-btn-lg" onClick={onCreateShop}>{t("landing_primary_cta")}</button>
            <button className="rk-btn-outline rk-btn-lg" onClick={onOpenLogin}>{t("landing_secondary_cta")}</button>
          </div>
          <div className="rk-trust-row" aria-label={t("landing_trust_label")}>
            <span>{t("landing_trust_trial")}</span>
            <span>{t("landing_trust_card")}</span>
            <span>{t("landing_trust_setup")}</span>
          </div>
        </div>

        <div className="rk-hero-visual" aria-label={t("landing_dashboard_preview")}>
          <div className="rk-dashboard-window">
            <div className="rk-window-bar">
              <span className="rk-window-mark">RK</span>
              <span>{t("landing_operations_center")}</span>
              <span className="rk-live"><i />{t("landing_live")}</span>
            </div>
            <div className="rk-metric-grid">
              <div><span>{t("inventory_value")}</span><strong>842,650</strong><small>{t("sar")}</small></div>
              <div><span>{t("landing_active_parts")}</span><strong>12,480</strong><small>SKU</small></div>
              <div><span>{t("low_stock_items")}</span><strong className="rk-warn">24</strong><small>{t("landing_attention")}</small></div>
            </div>
            <div className="rk-warehouse-map">
              <div className="rk-map-heading">
                <div><span>{t("landing_branch_inventory")}</span><strong>{t("landing_synced_now")}</strong></div>
                <span className="rk-map-filter">{t("landing_today")}</span>
              </div>
              <div className="rk-bars" aria-hidden="true">
                <i style={{ height: "42%" }} /><i style={{ height: "64%" }} /><i style={{ height: "52%" }} />
                <i style={{ height: "78%" }} /><i style={{ height: "70%" }} /><i style={{ height: "88%" }} />
                <i style={{ height: "74%" }} /><i style={{ height: "96%" }} />
              </div>
            </div>
            <div className="rk-part-row">
              <span className="rk-part-icon">A</span>
              <div><strong>04465-33480</strong><small>{t("landing_brake_set")}</small></div>
              <span className="rk-stock-ok">{t("landing_available")}</span>
              <strong>48</strong>
            </div>
            <div className="rk-part-row">
              <span className="rk-part-icon">B</span>
              <div><strong>90915-YZZE1</strong><small>{t("landing_oil_filter")}</small></div>
              <span className="rk-stock-low">{t("landing_low")}</span>
              <strong>6</strong>
            </div>
          </div>
          <div className="rk-orbit rk-orbit-one" />
          <div className="rk-orbit rk-orbit-two" />
        </div>
      </section>

      <section className="rk-proof-strip" aria-label={t("landing_platform_highlights")}>
        <div><strong>Multi-tenant</strong><span>{t("landing_proof_tenants")}</span></div>
        <div><strong>VIN + OEM</strong><span>{t("landing_proof_search")}</span></div>
        <div><strong>15% VAT</strong><span>{t("landing_proof_vat")}</span></div>
        <div><strong>Realtime</strong><span>{t("landing_proof_realtime")}</span></div>
      </section>

      <section id="capabilities" className="rk-section">
        <div className="rk-section-heading">
          <span>{t("landing_capabilities_kicker")}</span>
          <h2>{t("landing_capabilities_title")}</h2>
          <p>{t("landing_capabilities_body")}</p>
        </div>
        <div className="rk-feature-grid">
          {FEATURE_KEYS.map(([number, title, body]) => (
            <article className="rk-feature-card" key={number}>
              <span className="rk-feature-number">{number}</span>
              <h3>{t(title)}</h3>
              <p>{t(body)}</p>
              <span className="rk-feature-line" />
            </article>
          ))}
        </div>
      </section>

      <section className="rk-section rk-workflow-section">
        <div className="rk-workflow-copy">
          <span>{t("landing_workflow_kicker")}</span>
          <h2>{t("landing_workflow_title")}</h2>
          <p>{t("landing_workflow_body")}</p>
          <button className="rk-text-action" onClick={onCreateShop}>{t("landing_start_now")} <b aria-hidden="true">↗</b></button>
        </div>
        <div className="rk-workflow-list">
          {WORKFLOW_KEYS.map(([number, title, body]) => (
            <article key={number}>
              <span>{number}</span>
              <div><h3>{t(title)}</h3><p>{t(body)}</p></div>
            </article>
          ))}
        </div>
      </section>

      <section className="rk-cta-panel">
        <div><span>{t("landing_cta_kicker")}</span><h2>{t("landing_cta_title")}</h2><p>{t("landing_cta_body")}</p></div>
        <button className="rk-btn rk-btn-lg" onClick={onCreateShop}>{t("landing_primary_cta")}</button>
      </section>
    </main>
  );
}
