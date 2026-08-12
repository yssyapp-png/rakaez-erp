import React, { useEffect, useState } from "react";
import {
  getAllParts,
  createPart,
  updatePart,
  deletePart,
  updateInventory,
  getBranchesSummary,
  previewPartsImport,
  commitPartsImport,
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
  const [importOpen, setImportOpen] = useState(false);

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
        <button className="rk-btn-outline" onClick={() => setImportOpen((value) => !value)}>
          استيراد CSV
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

      {importOpen && (
        <PartsImportPanel
          branches={branches}
          onImported={() => {
            setImportOpen(false);
            setMessage({ type: "success", text: "تم استيراد المخزون بنجاح" });
            refresh();
          }}
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

const HEADER_ALIASES = {
  partnumber: "partNumber", "رقمالقطعة": "partNumber", "رقمالصنف": "partNumber",
  name: "name", "الاسم": "name", "اسمالقطعة": "name",
  brand: "brand", "العلامة": "brand", "الشركة": "brand",
  category: "category", "التصنيف": "category", "الفئة": "category",
  barcode: "barcode", "الباركود": "barcode",
  price: "price", "سعرالبيع": "price", "السعر": "price",
  cost: "cost", "سعرالشراء": "cost", "التكلفة": "cost",
  quantity: "quantity", "الكمية": "quantity",
  minquantity: "minQuantity", "الحدالأدنى": "minQuantity",
  shelfsection: "shelfSection", "القسم": "shelfSection",
  shelfnumber: "shelfNumber", "الرف": "shelfNumber",
  shelflevel: "shelfLevel", "المستوى": "shelfLevel",
};

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += char;
  }
  values.push(value.trim());
  return values;
}

function normalizeHeader(value) {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

function parsePartsCsv(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("الملف فارغ أو لا يحتوي صفوف بيانات");
  const mappedHeaders = parseCsvLine(lines[0]).map((header) => HEADER_ALIASES[normalizeHeader(header)] || null);
  if (!mappedHeaders.includes("partNumber") || !mappedHeaders.includes("name") || !mappedHeaders.includes("price")) {
    throw new Error("يجب أن يحتوي الملف على رقم القطعة والاسم وسعر البيع");
  }
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return mappedHeaders.reduce((row, field, index) => {
      if (field) row[field] = values[index] ?? "";
      return row;
    }, {});
  });
}

function PartsImportPanel({ branches, onImported }) {
  const [rows, setRows] = useState([]);
  const [mode, setMode] = useState("skip");
  const [branchId, setBranchId] = useState(branches[0]?.id || "");
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadFile(file) {
    setPreview(null);
    setError(null);
    try {
      const parsed = parsePartsCsv(await file.text());
      setRows(parsed);
    } catch (err) {
      setRows([]);
      setError(err.message);
    }
  }

  async function runPreview() {
    setBusy(true);
    const result = await previewPartsImport(rows, mode);
    setBusy(false);
    if (result.error) return setError(result.error);
    setError(null);
    setPreview(result);
  }

  async function runImport() {
    if (!preview || preview.invalid > 0) return;
    setBusy(true);
    const result = await commitPartsImport(rows, mode, Number(branchId));
    setBusy(false);
    if (result.error) return setError(result.error);
    onImported(result);
  }

  return (
    <div className="rk-card" style={{ marginBottom: 16 }}>
      <h4>استيراد مخزون من CSV</h4>
      <p style={{ fontSize: 13, color: "#666" }}>
        الأعمدة المطلوبة: رقم القطعة، الاسم، سعر البيع. المعاينة لا تحفظ أي بيانات.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={(event) => event.target.files[0] && loadFile(event.target.files[0])} />
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <select className="rk-select" value={branchId} onChange={(event) => { setBranchId(event.target.value); setPreview(null); }}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <select className="rk-select" value={mode} onChange={(event) => { setMode(event.target.value); setPreview(null); }}>
          <option value="skip">تجاهل القطع الموجودة</option>
          <option value="replace">استبدال البيانات والكمية</option>
          <option value="add">تحديث البيانات وجمع الكمية</option>
        </select>
        <button className="rk-btn-outline" disabled={!rows.length || busy} onClick={runPreview}>معاينة</button>
      </div>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      {preview && (
        <div style={{ marginTop: 12 }}>
          <p>الإجمالي: {preview.total} — صالح: {preview.valid} — جديد: {preview.new} — موجود: {preview.existing} — أخطاء: {preview.invalid}</p>
          {preview.errors?.slice(0, 10).map((item) => (
            <div key={item.rowNumber} style={{ color: "#b91c1c", fontSize: 13 }}>
              الصف {item.rowNumber}: {item.errors.join(", ")}
            </div>
          ))}
          <button className="rk-btn" disabled={preview.invalid > 0 || busy || !branchId} onClick={runImport}>
            اعتماد الاستيراد
          </button>
        </div>
      )}
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
