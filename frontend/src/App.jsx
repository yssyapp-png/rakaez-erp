import React, { useEffect, useState } from "react";
import CustomerView from "./pages/CustomerView.jsx";
import SellerView from "./pages/SellerView.jsx";
import AdminView from "./pages/AdminView.jsx";
import BillingView from "./pages/BillingView.jsx";
import PartsManagementView from "./pages/PartsManagementView.jsx";
import LoginView from "./pages/LoginView.jsx";
import WarehouseView from "./pages/WarehouseView.jsx";
import ProcurementView from "./pages/ProcurementView.jsx";
import TransfersView from "./pages/TransfersView.jsx";
import SecurityView from "./pages/SecurityView.jsx";
import BranchInventoryView from "./pages/BranchInventoryView.jsx";
import ComplianceView from "./pages/ComplianceView.jsx";
import { getCurrentUser, logout } from "./api/client.js";
import { useLanguage } from "./i18n/LanguageContext.jsx";
import { useTheme } from "./theme/ThemeContext.jsx";
import logo from "./assets/rakaez-logo-original.png";

const TAB_DEFS = [
  { key: "customer", labelKey: "tab_customer", Comp: CustomerView, roles: ["customer", "seller", "admin"] },
  { key: "seller", labelKey: "tab_seller", Comp: SellerView, roles: ["seller", "admin"] },
  { key: "parts", labelKey: "tab_parts", Comp: PartsManagementView, roles: ["admin"] },
  { key: "warehouse", labelKey: "tab_warehouse", Comp: WarehouseView, roles: ["warehouse_keeper", "admin"] },
  { key: "procurement", labelKey: "tab_procurement", Comp: ProcurementView, roles: ["warehouse_keeper", "admin"] },
  { key: "transfers", labelKey: "tab_transfers", Comp: TransfersView, roles: ["warehouse_keeper", "admin"] },
  { key: "branch_inventory", labelKey: "tab_branch_inventory", Comp: BranchInventoryView, roles: ["branch_manager", "admin"] },
  { key: "admin", labelKey: "tab_admin", Comp: AdminView, roles: ["admin"] },
  { key: "billing", labelKey: "tab_billing", Comp: BillingView, roles: ["admin"] },
  { key: "compliance", labelKey: "tab_compliance", Comp: ComplianceView, roles: ["admin"] },
  { key: "security", labelKey: "tab_security", Comp: SecurityView, roles: ["customer", "seller", "warehouse_keeper", "branch_manager", "admin"] },
];

function defaultTabForRole(role) {
  if (role === "admin") return "admin";
  if (role === "seller") return "seller";
  if (role === "warehouse_keeper") return "warehouse";
  if (role === "branch_manager") return "branch_inventory";
  return "customer";
}

export default function App() {
  const [tab, setTab] = useState("customer");
  const [user, setUser] = useState(null);
  const { t, lang, toggleLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    getCurrentUser()
      .then((restoredUser) => {
        if (restoredUser) {
          setUser(restoredUser);
          setTab(defaultTabForRole(restoredUser.role));
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

  async function onLogout() {
    await logout().catch(() => {});
    sessionStorage.removeItem("rakaez_pending_payment");
    setUser(null);
    setTab("customer");
  }

  return (
    <div className={`rk-app${user ? "" : " rk-app-guest"}`}>
      <header className={`rk-header${user ? "" : " rk-header-guest"}`}>
        <div className="rk-brand">
          <img className="rk-logo" src={logo} alt="ركائز" />
          <div>
            <h1>{t("appTitle")}</h1>
            {!user && <p>{t("brand_tagline")}</p>}
          </div>
        </div>
        <div className="rk-header-actions">
          {user && (
            <button
              type="button"
              className="rk-theme-toggle"
              onClick={toggleTheme}
              title={theme === "light" ? "الوضع الداكن (بني غامق وذهبي)" : "الوضع الفاتح (بني فاتح وذهبي)"}
              aria-label={theme === "light" ? "تفعيل الوضع الداكن" : "تفعيل الوضع الفاتح"}
            >
              {theme === "light" ? "🌙" : "☀️"}
            </button>
          )}
          <button type="button" className="rk-theme-toggle" onClick={toggleLang} title={lang === "ar" ? "Switch to English" : "التبديل إلى العربية"}>
            🌐 {t("lang_toggle")}
          </button>
          {user ? (
            <div style={{ fontSize: 13, color: "var(--rakaez-text-on-header)" }}>
              {t("welcome")} {user.name} ({user.role}) —{" "}
              <button type="button" className="rk-header-link" onClick={onLogout}>
                {t("logout")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="rk-header-cta"
              onClick={() => setTab("login")}
            >
              {t("login")}
            </button>
          )}
        </div>
      </header>

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
              setTab(defaultTabForRole(u.role));
            }}
          />
        ) : (
          <Active user={user} onCurrentSessionRevoked={onLogout} />
        )}
      </div>
    </div>
  );
}
