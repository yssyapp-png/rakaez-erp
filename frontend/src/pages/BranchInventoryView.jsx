import React, { useState } from "react";
import { searchBranchAvailability } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function shelfLabel(stock, t) {
  const location = [stock.shelfSection, stock.shelfNumber, stock.shelfLevel].filter(Boolean).join(" / ");
  return location || t("branch_inventory_shelf_unset");
}

export default function BranchInventoryView() {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  async function search(event) {
    event.preventDefault();
    const normalized = query.trim();
    if (normalized.length < 2) {
      setMessage({ type: "error", text: t("branch_inventory_query_hint") });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const data = await searchBranchAvailability(normalized, type);
      if (data?.error) throw new Error(data.error);
      setResult(data);
    } catch {
      setResult(null);
      setMessage({ type: "error", text: t("branch_inventory_search_error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="rk-page-heading">
        <div>
          <h2>{t("branch_inventory_title")}</h2>
          <p>{t("branch_inventory_subtitle")}</p>
        </div>
        <span className="rk-badge success">{t("branch_inventory_read_only")}</span>
      </div>

      <form className="rk-card rk-branch-search" onSubmit={search}>
        <select className="rk-select" value={type} onChange={(event) => setType(event.target.value)} aria-label={t("branch_inventory_search_type")}>
          <option value="all">{t("branch_inventory_type_all")}</option>
          <option value="part_number">{t("branch_inventory_type_part_number")}</option>
          <option value="barcode">{t("branch_inventory_type_barcode")}</option>
          <option value="oem">{t("branch_inventory_type_oem")}</option>
          <option value="name">{t("branch_inventory_type_name")}</option>
        </select>
        <input
          className="rk-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={120}
          autoComplete="off"
          placeholder={t("branch_inventory_search_placeholder")}
          aria-label={t("branch_inventory_search_placeholder")}
        />
        <button className="rk-btn" disabled={busy || query.trim().length < 2}>
          {busy ? t("loading") : t("branch_inventory_search")}
        </button>
      </form>

      {message && <div className={`rk-alert ${message.type}`} style={{ marginTop: 14 }}>{message.text}</div>}
      {result && !result.parts.length && (
        <div className="rk-card" style={{ marginTop: 16 }}>
          <strong>{t("branch_inventory_not_found")}</strong>
          <p>{t("branch_inventory_not_found_hint")}</p>
        </div>
      )}

      {result?.parts.map((part) => {
        const currentStock = part.availability.find((stock) => stock.isCurrentBranch);
        const alternatives = part.availability.filter((stock) => !stock.isCurrentBranch);
        return (
          <section className="rk-card rk-availability-card" key={part.id}>
            <div className="rk-availability-heading">
              <div>
                <div className="rk-part-number" dir="ltr">{part.partNumber}</div>
                <h3>{part.name}</h3>
                <p>{[part.brand, part.category].filter(Boolean).join(" — ") || t("branch_inventory_no_extra_details")}</p>
              </div>
              <div className="rk-availability-total">
                <span>{t("branch_inventory_total_available")}</span>
                <strong>{part.totalAvailable}</strong>
              </div>
            </div>

            {result.currentBranchId == null ? (
              <div className="rk-alert success">{t("branch_inventory_admin_overview")}</div>
            ) : (
              <div className={`rk-alert ${currentStock ? "success" : "error"}`}>
                {currentStock
                  ? `${t("branch_inventory_current_available")}: ${currentStock.quantity}`
                  : t("branch_inventory_current_unavailable")}
              </div>
            )}

            {!alternatives.length ? (
              <p>{t("branch_inventory_no_alternative")}</p>
            ) : (
              <div className="rk-table-wrap">
                <table className="rk-table">
                  <thead>
                    <tr>
                      <th>{t("col_branch")}</th>
                      <th>{t("branch_inventory_city")}</th>
                      <th>{t("quantity")}</th>
                      <th>{t("branch_inventory_shelf")}</th>
                      <th>{t("branch_inventory_recommendation")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alternatives.map((stock) => (
                      <tr key={stock.branchId}>
                        <td><strong>{stock.branchName}</strong></td>
                        <td>{stock.city || "—"}</td>
                        <td><span className="rk-badge success">{stock.quantity}</span></td>
                        <td>{shelfLabel(stock, t)}</td>
                        <td>{t("branch_inventory_contact_branch")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
