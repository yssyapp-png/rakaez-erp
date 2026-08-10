import React, { useState } from "react";
import { login, register } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

// The demo tenant seeded by seed.sql — used as the default "join this shop"
// target when a customer/seller signs up without specifying one. In a real
// multi-shop deployment this would come from a shop-specific signup link
// (e.g. rakaez.app/shop/riyadh-auto or a QR code the shop hands out), not a
// hardcoded id.
const DEFAULT_DEMO_ORG_ID = 1;

export default function LoginView({ onLoggedIn }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState("login"); // 'login' | 'join' | 'new-shop'
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("seller1@example.com");
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
        data = await login(email, password);
      } else if (mode === "join") {
        data = await register({ name, email, password, role: "customer", organizationId: DEFAULT_DEMO_ORG_ID });
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

      {(mode === "join" || mode === "new-shop") && (
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
        {mode !== "join" && (
          <a className="rk-link" onClick={() => setMode("join")}>
            {t("new_customer")}
          </a>
        )}
        {mode !== "new-shop" && (
          <a className="rk-link" style={{ color: "#166534" }} onClick={() => setMode("new-shop")}>
            {t("shop_owner")}
          </a>
        )}
      </div>
      <div style={{ fontSize: 12, color: "#6b5a3f", textAlign: "center" }}>{t("demo_accounts")}</div>
    </form>
  );
}
