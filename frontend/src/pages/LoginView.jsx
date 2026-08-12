import React, { useState } from "react";
import { acceptInvitation, login, register } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function LoginView({ onLoggedIn }) {
  const { t } = useLanguage();
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
      setError("تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.");
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
    <form onSubmit={onSubmit} className="rk-card rk-fade-in" style={{ maxWidth: 380, margin: "60px auto", display: "grid", gap: 12 }}>
      <h2 style={{ textAlign: "center", color: "var(--rakaez-text)", margin: 0 }}>
        {titles[mode]} — {t("brandSuffix")}
      </h2>

      {mode === "new-shop" && (
        <div style={{ fontSize: 12, color: "#166534", background: "#f0fdf4", padding: 10, borderRadius: 6 }}>
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
        <div style={{ fontSize: 12, color: "#6b5a3f" }}>كلمة المرور: 12 حرفًا على الأقل وتحتوي على حرف ورقم.</div>
      )}
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
        {mode !== "invitation" && (
          <a className="rk-link" onClick={() => setMode("invitation")}>{t("have_invitation")}</a>
        )}
      </div>
      {mode === "login" && <div style={{ fontSize: 12, color: "#6b5a3f", textAlign: "center" }}>{t("organization_code_hint")}</div>}
    </form>
  );
}
