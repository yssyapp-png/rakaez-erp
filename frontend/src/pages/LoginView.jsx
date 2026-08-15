import React, { useEffect, useState } from "react";
import { acceptInvitation, login, register } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function LoginView({ onLoggedIn, initialMode = "login" }) {
  const { t } = useLanguage();
  const inviteFromUrl = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("invite") || "";
  const [mode, setMode] = useState(inviteFromUrl ? "invitation" : initialMode);
  const [inviteToken, setInviteToken] = useState(inviteFromUrl);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [organizationCode, setOrganizationCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!inviteFromUrl) setMode(initialMode);
  }, [initialMode, inviteFromUrl]);

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
      } else {
        // new-shop: creates a brand-new organization (tenant) with this user as its first admin
        data = await register({ name, email, password, role: "admin", businessName });
      }
      if (data.error) {
        setError(
          data.error === "email_taken"
            ? t("err_email_taken")
            : data.error === "missing_business_name"
            ? t("err_missing_business_name")
            : data.error === "weak_password"
            ? t("err_weak_password")
            : t("err_generic")
        );
        return;
      }
      if (mode === "invitation") window.history.replaceState({}, "", window.location.pathname);
      onLoggedIn(data.user);
    } catch {
      setError(t("connection_error"));
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
    <div className="rk-auth-layout">
      <div className="rk-auth-intro">
        <span className="rk-eyebrow"><i />{t("auth_kicker")}</span>
        <h2>{t("auth_intro_title")}</h2>
        <p>{t("auth_intro_body")}</p>
        <ul><li>{t("auth_point_secure")}</li><li>{t("auth_point_tenant")}</li><li>{t("auth_point_audit")}</li></ul>
      </div>
    <form onSubmit={onSubmit} className="rk-card rk-auth-card rk-fade-in">
      <div className="rk-auth-heading">
        <span>{t("brandSuffix")}</span>
        <h2>{titles[mode]}</h2>
        <p>{mode === "login" ? t("login_welcome_back") : mode === "new-shop" ? t("new_shop_subtitle") : t("invitation_subtitle")}</p>
      </div>

      {mode === "new-shop" && (
        <div className="rk-auth-notice">
          {t("trial_notice")}
        </div>
      )}

      {(mode === "new-shop" || mode === "invitation") && (
        <input className="rk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("full_name")} maxLength={120} required />
      )}
      {mode === "new-shop" && (
        <input
          className="rk-input"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={t("business_name")}
          maxLength={200}
          required
        />
      )}
      {mode !== "invitation" && (
        <input className="rk-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email")} maxLength={254} autoComplete="email" required />
      )}
      {mode === "login" && (
        <input
          className="rk-input"
          value={organizationCode}
          onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())}
          placeholder={t("organization_code")}
          autoComplete="organization"
          maxLength={32}
          required
        />
      )}
      {mode === "invitation" && (
        <input
          className="rk-input"
          value={inviteToken}
          onChange={(e) => setInviteToken(e.target.value)}
          placeholder={t("invitation_code")}
          maxLength={100}
          autoComplete="off"
          required
        />
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
      {mode !== "login" && (
        <div className="rk-field-hint">{t("password_hint")}</div>
      )}
      {error && <div className="rk-auth-error" role="alert">{error}</div>}
      <button disabled={loading} className="rk-btn">
        {loading ? t("submitting") : titles[mode]}
      </button>

      <div className="rk-auth-links">
        {mode !== "login" && (
          <button type="button" className="rk-link" onClick={() => setMode("login")}>
            {t("have_account")}
          </button>
        )}
        {mode !== "new-shop" && (
          <button type="button" className="rk-link rk-link-accent" onClick={() => setMode("new-shop")}>
            {t("shop_owner")}
          </button>
        )}
        {mode !== "invitation" && (
          <button type="button" className="rk-link" onClick={() => setMode("invitation")}>{t("have_invitation")}</button>
        )}
      </div>
      {mode === "login" && <div className="rk-field-hint rk-field-hint-centered">{t("organization_code_hint")}</div>}
    </form>
    </div>
  );
}
