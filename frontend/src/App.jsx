import React, { useEffect, useState } from "react";
import CustomerView from "./pages/CustomerView.jsx";
import SellerView from "./pages/SellerView.jsx";
import AdminView from "./pages/AdminView.jsx";
import BillingView from "./pages/BillingView.jsx";
import PartsManagementView from "./pages/PartsManagementView.jsx";
import LoginView from "./pages/LoginView.jsx";
import WarehouseView from "./pages/WarehouseView.jsx";
import { getCurrentUser, logout } from "./api/client.js";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import { useTheme } from "./theme/ThemeContext.jsx";
import logo from "./assets/rakaez-logo.svg";

const TAB_DEFS = [
  { key: "customer", labelKey: "tab_customer", Comp: CustomerView, roles: ["customer", "seller", "admin"] },
  { key: "seller", labelKey: "tab_seller", Comp: SellerView, roles: ["seller", "admin"] },
  { key: "parts", labelKey: "tab_parts", Comp: PartsManagementView, roles: ["seller", "admin"] },
  { key: "warehouse", labelKey: "tab_warehouse", Comp: WarehouseView, roles: ["warehouse_keeper", "admin"] },
  { key: "admin", labelKey: "tab_admin", Comp: AdminView, roles: ["admin"] },
  { key: "billing", labelKey: "tab_billing", Comp: BillingView, roles: ["admin"] },
];

export default function App() {
  const [tab, setTab] = useState("customer");
  const [user, setUser] = useState(null);
  const { t, lang, toggleLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    getCurrentUser()
      .then((restoredUser) => {
        if (restoredUser) setUser(restoredUser);
      })
      .catch(() => {});
  }, []);

  const visibleTabs = TAB_DEFS.filter((tb) => user && tb.roles.includes(user.role));
  const Active = visibleTabs.find((tb) => tb.key === tab)?.Comp || visibleTabs[0]?.Comp || LoginView;

  function onLogout() {
    logout();
    setUser(null);
    setTab("customer");
  }

  return (
    <div className="rk-app">
      <div className="rk-header">
        <div className="rk-brand">
          <img className="rk-logo" src={logo} alt="ركائز" />
          <div>
            <h1>{t("appTitle")}</h1>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="rk-theme-toggle"
            onClick={toggleTheme}
            title={theme === "light" ? "الوضع الداكن (بني غامق وذهبي)" : "الوضع الفاتح (بني فاتح وذهبي)"}
          >
            {theme === "light" ? "🌙" : "☀️"}
          </button>
          <button className="rk-theme-toggle" onClick={toggleLang} title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}>
            🌐 {t("lang_toggle")}
          </button>
          {user ? (
            <div style={{ fontSize: 13, color: "var(--rakaez-text-on-header)" }}>
              {t("welcome")} {user.name} ({user.role}) —{" "}
              <a style={{ cursor: "pointer", color: "var(--rakaez-text-on-header)", textDecoration: "underline" }} onClick={onLogout}>
                {t("logout")}
              </a>
            </div>
          ) : (
            <a
              style={{ cursor: "pointer", color: "var(--rakaez-text-on-header)", fontSize: 13, fontWeight: 700 }}
              onClick={() => setTab("login")}
            >
              {t("login")}
            </a>
          )}
        </div>
      </div>

      <div className="rk-tabs">
        {visibleTabs.map((tb) => (
          <button key={tb.key} className={`rk-tab${tab === tb.key ? " active" : ""}`} onClick={() => setTab(tb.key)}>
            {t(tb.labelKey)}
          </button>
        ))}
      </div>

      <div className="rk-fade-in">
        {tab === "login" || !user ? (
          <LoginView
            onLoggedIn={(u) => {
              setUser(u);
              setTab(
                u.role === "admin"
                  ? "admin"
                  : u.role === "seller"
                    ? "seller"
                    : u.role === "warehouse_keeper"
                      ? "warehouse"
                      : "customer"
              );
            }}
          />
        ) : tab === "customer" ? (
          <CustomerView user={user} />
        ) : (
          <Active user={user} />
        )}
      </div>
    </div>
  );
}
