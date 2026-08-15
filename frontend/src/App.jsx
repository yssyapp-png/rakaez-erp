import React, { useEffect, useState } from "react";
import CustomerView from "./pages/CustomerView.jsx";
import SellerView from "./pages/SellerView.jsx";
import AdminView from "./pages/AdminView.jsx";
import BillingView from "./pages/BillingView.jsx";
import PartsManagementView from "./pages/PartsManagementView.jsx";
import LoginView from "./pages/LoginView.jsx";
import WarehouseView from "./pages/WarehouseView.jsx";
import LandingPage from "./components/LandingPage.jsx";
import { getCurrentUser, logout } from "./api/client.js";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import { useTheme } from "./theme/ThemeContext.jsx";
import logo from "./assets/rakaez-logo.svg";

const TAB_DEFS = [
  { key: "customer", labelKey: "tab_customer", Comp: CustomerView, roles: ["customer", "seller", "admin"] },
  { key: "seller", labelKey: "tab_seller", Comp: SellerView, roles: ["seller", "admin"] },
  { key: "parts", labelKey: "tab_parts", Comp: PartsManagementView, roles: ["admin"] },
  { key: "warehouse", labelKey: "tab_warehouse", Comp: WarehouseView, roles: ["warehouse_keeper", "admin"] },
  { key: "admin", labelKey: "tab_admin", Comp: AdminView, roles: ["admin"] },
  { key: "billing", labelKey: "tab_billing", Comp: BillingView, roles: ["admin"] },
];

export default function App() {
  const [tab, setTab] = useState("customer");
  const [authMode, setAuthMode] = useState("login");
  const [user, setUser] = useState(null);
  const { t, lang, toggleLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    getCurrentUser()
      .then((restoredUser) => {
        if (restoredUser) {
          setUser(restoredUser);
          const pending = sessionStorage.getItem("rakaez_pending_payment");
          if (pending) {
            try {
              const purpose = JSON.parse(pending).purpose;
              if (purpose === "subscription_activation" && restoredUser.role === "admin") setTab("billing");
              if (purpose === "online_order") setTab("customer");
            } catch {
              sessionStorage.removeItem("rakaez_pending_payment");
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  const visibleTabs = TAB_DEFS.filter((tb) => user && tb.roles.includes(user.role));
  const Active = visibleTabs.find((tb) => tb.key === tab)?.Comp || visibleTabs[0]?.Comp || LoginView;

  function onLogout() {
    logout();
    sessionStorage.removeItem("rakaez_pending_payment");
    setUser(null);
    setTab("customer");
  }

  function openAuth(mode = "login") {
    setAuthMode(mode);
    setTab("login");
    window.requestAnimationFrame(() => document.getElementById("access")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className={`rk-app${user ? " rk-app-authenticated" : " rk-app-public"}`}>
      <header className="rk-header">
        <button
          type="button"
          className="rk-brand rk-brand-button"
          onClick={() => {
            if (!user) {
              setTab("customer");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }
          }}
          aria-label={!user ? t("back_home") : undefined}
          disabled={Boolean(user)}
        >
          <img className="rk-logo" src={logo} alt="ركائز" />
          <div>
            <h1>{t("appTitle")}</h1>
            <p>{user ? t("workspace_subtitle") : t("brand_descriptor")}</p>
          </div>
        </button>
        {!user && <nav className="rk-public-nav" aria-label={t("main_navigation")}>
          <a href="#capabilities">{t("nav_capabilities")}</a>
          <button type="button" onClick={() => openAuth("new-shop")}>{t("nav_access")}</button>
        </nav>}
        <div className="rk-header-actions">
          <button
            className="rk-theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "light" ? t("dark_mode") : t("light_mode")}
            title={theme === "light" ? t("dark_mode") : t("light_mode")}
          >
            <span aria-hidden="true">{theme === "light" ? "◐" : "☼"}</span>
          </button>
          <button className="rk-theme-toggle" onClick={toggleLang} title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}>
            {t("lang_toggle")}
          </button>
          {user ? (
            <div className="rk-user-menu">
              <span className="rk-user-avatar">{String(user.name || "R").trim().charAt(0).toUpperCase()}</span>
              <span><b>{user.name}</b><small>{t(`role_${user.role}`)}</small></span>
              <button className="rk-header-link" onClick={onLogout}>{t("logout")}</button>
            </div>
          ) : (
            <button className="rk-header-link" onClick={() => openAuth("login")}>
              {t("login")}
            </button>
          )}
        </div>
      </header>

      {user && <nav className="rk-tabs" aria-label={t("workspace_navigation")}>
        {visibleTabs.map((tb) => (
          <button key={tb.key} className={`rk-tab${tab === tb.key ? " active" : ""}`} onClick={() => setTab(tb.key)}>
            {t(tb.labelKey)}
          </button>
        ))}
      </nav>}

      <div className="rk-fade-in rk-content">
        {!user && tab !== "login" ? (
          <LandingPage onOpenLogin={() => openAuth("login")} onCreateShop={() => openAuth("new-shop")} />
        ) : tab === "login" || !user ? (
          <section id="access" className="rk-auth-section">
          <LoginView
            initialMode={authMode}
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
          </section>
        ) : tab === "customer" ? (
          <CustomerView user={user} />
        ) : (
          <Active user={user} />
        )}
      </div>
      {!user && <footer className="rk-footer">
        <div className="rk-brand rk-footer-brand"><img className="rk-logo" src={logo} alt="" /><div><strong>{t("brand_name")}</strong><span>{t("brand_descriptor")}</span></div></div>
        <p>{t("footer_note")}</p>
        <span>© {new Date().getFullYear()} Rakaez</span>
      </footer>}
    </div>
  );
}
