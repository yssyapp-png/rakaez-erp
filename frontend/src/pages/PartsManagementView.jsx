import React, { useEffect, useState } from "react";
import {
  getAllParts,
  createPart,
  updatePart,
  deletePart,
  updateInventory,
  getBranchesSummary,
} from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

/**
 * Lets a shop owner/seller manage their own catalog and stock levels from
 * the dashboard — no developer involvement needed after they subscribe.
 * This is the piece that turns Rakaez from "a system I configure for you"
 * into a self-serve platform other shops can run themselves.
 */
export default function PartsManagementView() {
  const { t } = useLanguage();
  const [parts, setParts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [editing, setEditing] = useState(null); // part being edited, or "new"
  const [message, setMessage] = useState(null);

  function refresh() {
    getAllParts().then(setParts);
    getBranchesSummary().then((b) => setBranches(Array.isArray(b) ? b : []));
  }

  useEffect(refresh, []);

  async function onSave(form) {
    const payload = {
      partNumber: form.partNumber,
      name: form.name,
      brand: form.brand,
      category: form.category,
      price: Number(form.price),
      cost: Number(form.cost || 0),
      branchId: form.branchId || undefined,
      quantity: Number(form.quantity || 0),
      minQuantity: Number(form.minQuantity || 5),
    };
    const result =
      editing === "new" ? await createPart(payload) : await updatePart(editing.id, payload);
    if (result.error) {
      setMessage({ type: "error", text: `${t("error_prefix")}: ${result.error}` });
      return;
    }
    setMessage({ type: "success", text: t("saved_success") });
    setEditing(null);
    refresh();
  }

  async function onDelete(id) {
    await deletePart(id);
    refresh();
  }

  async function onStockChange(part, branchId, quantity) {
    await updateInventory(part.id, { branchId, quantity: Number(quantity) });
    refresh();
  }

  async function onActivate(part) {
    const result = await updatePart(part.id, { catalogStatus: "active" });
    setMessage(result.error ? { type: "error", text: result.error } : { type: "success", text: "تم تفعيل القطعة" });
    refresh();
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h3>{t("parts_title")}</h3>
        <button className="rk-btn" onClick={() => setEditing("new")}>
          {t("add_new_part")}
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: 10,
            borderRadius: 8,
            marginBottom: 12,
            background: message.type === "success" ? "#f0fdf4" : "#fef2f2",
            color: message.type === "success" ? "#166534" : "#991b1b",
          }}
        >
          {message.text}
        </div>
      )}

      {editing && (
        <PartForm
          initial={editing === "new" ? null : editing}
          branches={branches}
          onCancel={() => setEditing(null)}
          onSave={onSave}
          t={t}
        />
      )}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #ddd", textAlign: "right" }}>
            <th style={{ padding: 8 }}>{t("col_part_number")}</th>
            <th style={{ padding: 8 }}>{t("col_name")}</th>
            <th style={{ padding: 8 }}>{t("col_brand")}</th>
            <th style={{ padding: 8 }}>{t("col_price")}</th>
            <th style={{ padding: 8 }}>{t("col_stock_per_branch")}</th>
            <th style={{ padding: 8 }}></th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{part.part_number}</td>
              <td style={{ padding: 8 }}>{part.name}</td>
              <td style={{ padding: 8 }}>{part.brand}</td>
              <td style={{ padding: 8 }}>
                {Number(part.price).toFixed(2)} {t("sar")}
              </td>
              <td style={{ padding: 8 }}>
                {branches.map((b) => (
                  <span key={b.id} style={{ marginInlineEnd: 10, fontSize: 12 }}>
                    {b.name}:{" "}
                    <input
                      type="number"
                      defaultValue={0}
                      style={{ width: 50 }}
                      onBlur={(e) => onStockChange(part, b.id, e.target.value)}
                    />
                  </span>
                ))}
              </td>
              <td style={{ padding: 8 }}>
                {part.catalog_status === "draft" && <button className="rk-btn-outline" onClick={() => onActivate(part)}>تفعيل</button>}
                <a style={{ cursor: "pointer", color: "#3b82f6", marginInlineEnd: 8 }} onClick={() => setEditing(part)}>
                  {t("edit")}
                </a>
                <a style={{ cursor: "pointer", color: "#dc2626" }} onClick={() => onDelete(part.id)}>
                  {t("delete")}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {parts.length === 0 && <p style={{ color: "#777", marginTop: 20 }}>{t("no_parts_yet")}</p>}
    </div>
  );
}

function PartForm({ initial, branches, onCancel, onSave, t }) {
  const [form, setForm] = useState({
    partNumber: initial?.part_number || "",
    name: initial?.name || "",
    brand: initial?.brand || "",
    category: initial?.category || "",
    price: initial?.price || "",
    cost: initial?.cost || "",
    branchId: branches[0]?.id || "",
    quantity: 0,
    minQuantity: 5,
  });

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="rk-card" style={{ marginBottom: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <input className="rk-input" placeholder={t("ph_part_number")} value={form.partNumber} onChange={(e) => set("partNumber", e.target.value)} disabled={!!initial} />
        <input className="rk-input" placeholder={t("ph_name")} value={form.name} onChange={(e) => set("name", e.target.value)} />
        <input className="rk-input" placeholder={t("ph_brand")} value={form.brand} onChange={(e) => set("brand", e.target.value)} />
        <input className="rk-input" placeholder={t("ph_category")} value={form.category} onChange={(e) => set("category", e.target.value)} />
        <input className="rk-input" placeholder={t("ph_price")} type="number" value={form.price} onChange={(e) => set("price", e.target.value)} />
        <input className="rk-input" placeholder={t("ph_cost")} type="number" value={form.cost} onChange={(e) => set("cost", e.target.value)} />
        {!initial && (
          <>
            <select className="rk-select" value={form.branchId} onChange={(e) => set("branchId", e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <input className="rk-input" placeholder={t("ph_initial_qty")} type="number" value={form.quantity} onChange={(e) => set("quantity", e.target.value)} />
          </>
        )}
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <button className="rk-btn" onClick={() => onSave(form)}>
          {t("save")}
        </button>
        <button className="rk-btn-outline" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
