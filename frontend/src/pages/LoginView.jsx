import React, { useState } from "react";
import { acceptInvitation, login, register } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function LoginView({ onLoggedIn }) {
  const { t } = useLanguage();
  const publicRegistrationEnabled = import.meta.env.VITE_PUBLIC_REGISTRATION_ENABLED === "true";
  const inviteFromUrl = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") || "";
  const [mode, setMode] = useState(inviteFromUrl ? "invitation" : "login");
  const [inviteToken, setInviteToken] = useState(inviteFromUrl);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let data;
      if (mode === "login") {
        data = await login(email, password, organizationCode);
      } else if (mode === "invitation") {
        data = await acceptInvitation(inviteToken.trim(), name, password);
      } else if (publicRegistrationEnabled) {
        // new-shop: creates a brand-new organization (tenant) with this user as its first admin
        data = await register({ name, email, password, role: "admin", businessName });
      } else {
        data = { error: "public_registration_disabled" };
      }
      if (data.error) {
        setError(
          data.error === "email_taken"
            ? t("err_email_taken")
            : data.error === "missing_business_name"
            ? t("err_missing_business_name")
            : data.error === "weak_password"
            ? t("err_weak_password")
            : data.error === "login_temporarily_blocked" || data.error === "auth_rate_limited"
            ? t("err_login_temporarily_blocked")
            : t("err_generic")
        );
        return;
      }
      if (mode === "invitation") window.history.replaceState({}, "", window.location.pathname);
      onLoggedIn(data.user);
    } catch {
      setError(t("err_connection"));
    } finally {
      setLoading(false);
    }
  }

  const titles = {
    login: t("login_title"),
    invitation: t("invitation_title"),
    "new-shop": t("new_shop_title"),
  };

  return (
    <main className="rk-auth-shell rk-fade-in">
      <section className="rk-auth-story" aria-labelledby="rakaez-hero-title">
        <div className="rk-orbit rk-orbit-one" aria-hidden="true" />
        <div className="rk-orbit rk-orbit-two" aria-hidden="true" />
        <div className="rk-auth-copy">
          <span className="rk-eyebrow"><i aria-hidden="true" />{t("hero_eyebrow")}</span>
          <h2 id="rakaez-hero-title">
            {t("hero_title")} <strong>{t("hero_title_accent")}</strong>
          </h2>
          <p>{t("hero_copy")}</p>

          <div className="rk-feature-grid" aria-label={t("hero_features_label")}>
            <article>
              <span aria-hidden="true">01</span>
              <strong>{t("hero_feature_inventory")}</strong>
              <small>{t("hero_feature_inventory_copy")}</small>
            </article>
            <article>
              <span aria-hidden="true">02</span>
              <strong>{t("hero_feature_branches")}</strong>
              <small>{t("hero_feature_branches_copy")}</small>
            </article>
            <article>
              <span aria-hidden="true">03</span>
              <strong>{t("hero_feature_security")}</strong>
              <small>{t("hero_feature_security_copy")}</small>
            </article>
          </div>
        </div>

        <div className="rk-system-preview" aria-hidden="true">
          <div className="rk-preview-top"><span /><span /><span /></div>
          <div className="rk-preview-grid">
            <div className="rk-preview-sidebar"><b /><i /><i /><i /></div>
            <div className="rk-preview-content">
              <div className="rk-preview-title"><span /><em /></div>
              <div className="rk-preview-stats"><b /><b /><b /></div>
              <div className="rk-preview-chart"><i /><i /><i /><i /><i /><i /></div>
            </div>
          </div>
        </div>
      </section>

      <section className="rk-auth-panel" aria-labelledby="rakaez-login-title">
        <div className="rk-auth-status"><span aria-hidden="true" />{t("hero_secure_status")}</div>
        <form onSubmit={onSubmit} className="rk-auth-form">
          <div className="rk-auth-heading">
            <span>{t("brandSuffix")}</span>
            <h2 id="rakaez-login-title">{titles[mode]}</h2>
            <p>{t("login_welcome_copy")}</p>
          </div>

          {mode === "new-shop" && <div className="rk-auth-notice">{t("trial_notice")}</div>}

          {(mode === "new-shop" || mode === "invitation") && (
            <input className="rk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("full_name")} maxLength={120} required />
          )}
          {mode === "new-shop" && (
            <input className="rk-input" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder={t("business_name")} maxLength={200} required />
          )}
          {mode !== "invitation" && (
            <input className="rk-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email")} maxLength={254} autoComplete="email" required />
          )}
          {mode === "login" && (
            <input className="rk-input" value={organizationCode} onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())} placeholder={t("organization_code")} autoComplete="organization" maxLength={32} required />
          )}
          {mode === "invitation" && (
            <input className="rk-input" value={inviteToken} onChange={(e) => setInviteToken(e.target.value)} placeholder={t("invitation_code")} maxLength={100} autoComplete="off" required />
          )}
          <input
            className="rk-input"
            type="password"
            minLength={mode === "login" ? undefined : 12}
            maxLength={128}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("password")}
            required
          />
          {mode !== "login" && <div className="rk-auth-hint">{t("password_requirements")}</div>}
          {error && <div className="rk-auth-error" role="alert">{error}</div>}
          <button disabled={loading} className="rk-btn rk-auth-submit">
            {loading ? t("submitting") : titles[mode]}
          </button>

          <div className="rk-auth-links">
            {mode !== "login" && <button type="button" className="rk-link" onClick={() => setMode("login")}>{t("have_account")}</button>}
            {publicRegistrationEnabled && mode !== "new-shop" && <button type="button" className="rk-link rk-link-success" onClick={() => setMode("new-shop")}>{t("shop_owner")}</button>}
            {mode !== "invitation" && <button type="button" className="rk-link" onClick={() => setMode("invitation")}>{t("have_invitation")}</button>}
          </div>
          {mode === "login" && <div className="rk-auth-hint rk-auth-hint-center">{t("organization_code_hint")}</div>}
        </form>
        <p className="rk-auth-privacy">{t("login_privacy_note")}</p>
      </section>
    </main>
  );
}
