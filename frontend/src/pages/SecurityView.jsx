import React, { useEffect, useState } from "react";
import { changePassword, getSessions, revokeOtherSessions, revokeSession } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function SecurityView({ onCurrentSessionRevoked }) {
  const { t, lang } = useLanguage();
  const [sessions, setSessions] = useState([]);
  const [message, setMessage] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const locale = lang === "ar" ? "ar-SA" : "en-US";

  async function load() {
    const result = await getSessions();
    if (result.error) return setMessage(t("security_load_error"));
    setSessions(Array.isArray(result.sessions) ? result.sessions : []);
  }

  useEffect(() => { load(); }, []);

  async function revoke(id) {
    const result = await revokeSession(id);
    if (result.error) return setMessage(t("security_revoke_error"));
    if (result.currentSessionRevoked) return onCurrentSessionRevoked?.();
    setMessage(t("security_session_revoked"));
    load();
  }

  async function revokeOthers() {
    const result = await revokeOtherSessions();
    if (result.error) return setMessage(t("security_revoke_error"));
    setMessage(`${t("security_other_sessions_revoked")}: ${result.revokedCount}`);
    load();
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setMessage(t("security_password_mismatch"));
    const result = await changePassword(currentPassword, newPassword);
    if (result.error) {
      return setMessage(result.error === "current_password_invalid"
        ? t("security_current_password_invalid")
        : t("security_password_change_error"));
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage(`${t("security_password_changed")} (${result.revokedSessions})`);
    load();
  }

  return (
    <div className="rk-card">
      <h2>{t("security_title")}</h2>
      <p>{t("security_subtitle")}</p>
      <form onSubmit={submitPasswordChange} className="rk-card" style={{ display: "grid", gap: 10, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>{t("security_change_password")}</h3>
        <input className="rk-input" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t("security_current_password")} required />
        <input className="rk-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t("security_new_password")} required />
        <input className="rk-input" type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder={t("security_confirm_password")} required />
        <button className="rk-btn" type="submit">{t("security_change_password")}</button>
        <small>{t("security_password_hint")}</small>
      </form>
      <div style={{ marginBottom: 16 }}>
        <button className="rk-btn" onClick={revokeOthers}>{t("security_revoke_others")}</button>
      </div>
      {message && <p role="status">{message}</p>}
      <div style={{ overflowX: "auto" }}>
        <table width="100%">
          <thead>
            <tr>
              <th>{t("security_session")}</th>
              <th>{t("security_created")}</th>
              <th>{t("security_last_seen")}</th>
              <th>{t("security_expires")}</th>
              <th>{t("security_action")}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id}>
                <td>{session.current ? t("security_current") : `${session.id.slice(0, 8)}…`}</td>
                <td>{new Date(session.created_at).toLocaleString(locale)}</td>
                <td>{new Date(session.last_seen_at).toLocaleString(locale)}</td>
                <td>{new Date(session.expires_at).toLocaleString(locale)}</td>
                <td>
                  {session.revoked_at
                    ? t("security_revoked")
                    : <button className="rk-btn" onClick={() => revoke(session.id)}>{t("security_revoke")}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 13, color: "var(--rakaez-muted)" }}>{t("security_privacy_note")}</p>
    </div>
  );
}
