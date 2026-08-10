import React, { useState } from "react";
import { login, register } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function LoginView({ onLoggedIn }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState("login"); // 'login' | 'new-shop'
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
            : t("err_generic")
        );
        return;
      }
      onLoggedIn(data.user);
    } finally {
      setLoading(false);
    }
  }

  const titles = {
    login: t("login_title"),
    join: t("join_title"),
    "new-shop": t("new_shop_title"),
  };

  return (
    <form onSubmit={onSubmit} className="rk-card rk-fade-in" style={{ maxWidth: 380, margin: "60px auto", display: "grid", gap: 12 }}>
      <h2 style={{ textAlign: "center", color: "var(--rakaez-text)", margin: 0 }}>
        {titles[mode]} — {t("brandSuffix")}
      </h2>

      {mode === "new-shop" && (
        <div style={{ fontSize: 12, color: "#166534", background: "#f0fdf4", padding: 10, borderRadius: 6 }}>
          {t("trial_notice")}
        </div>
      )}

      {mode === "new-shop" && (
        <input className="rk-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("full_name")} />
      )}
      {mode === "new-shop" && (
        <input
          className="rk-input"
          value={businessName}
          onChange={(e) => setBusinessName(e.target.value)}
          placeholder={t("business_name")}
        />
      )}
      <input className="rk-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("email")} />
      {mode === "login" && (
        <input
          className="rk-input"
          value={organizationCode}
          onChange={(e) => setOrganizationCode(e.target.value.toUpperCase())}
          placeholder={t("organization_code")}
          autoComplete="organization"
        />
      )}
      <input
        className="rk-input"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t("password")}
      />
      {error && <div style={{ color: "#B3261E", fontSize: 13 }}>{error}</div>}
      <button disabled={loading} className="rk-btn">
        {loading ? t("submitting") : titles[mode]}
      </button>

      <div style={{ fontSize: 13, textAlign: "center", display: "grid", gap: 6 }}>
        {mode !== "login" && (
          <a className="rk-link" onClick={() => setMode("login")}>
            {t("have_account")}
          </a>
        )}
        {mode !== "new-shop" && (
          <a className="rk-link" style={{ color: "#166534" }} onClick={() => setMode("new-shop")}>
            {t("shop_owner")}
          </a>
        )}
      </div>
      {mode === "login" && <div style={{ fontSize: 12, color: "#6b5a3f", textAlign: "center" }}>{t("organization_code_hint")}</div>}
    </form>
  );
}
