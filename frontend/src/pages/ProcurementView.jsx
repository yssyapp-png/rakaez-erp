import React, { useEffect, useMemo, useState } from "react";
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  getAllParts,
  getBranchesSummary,
  getPurchaseOrders,
  getSuppliers,
  isDevicePaired,
  receivePurchaseOrder,
} from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const EMPTY_LINE = { partId: "", quantity: 1, unitCost: 0 };

const STATUS_CLASS = {
  received: "success",
  approved: "success",
  partially_received: "danger",
  draft: "",
  cancelled: "danger",
};

export default function ProcurementView({ user }) {
  const { t } = useLanguage();
  const [suppliers, setSuppliers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [parts, setParts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [devicePaired, setDevicePaired] = useState(false);

  async function reload() {
    const [nextSuppliers, nextOrders] = await Promise.all([getSuppliers(), getPurchaseOrders()]);
    setSuppliers(Array.isArray(nextSuppliers) ? nextSuppliers : []);
    setOrders(Array.isArray(nextOrders) ? nextOrders : []);
    if (user.role === "admin") {
      const [nextParts, nextBranches] = await Promise.all([getAllParts(), getBranchesSummary()]);
      setParts(Array.isArray(nextParts) ? nextParts : []);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
    }
  }

  useEffect(() => {
    reload().catch(() => setMessage({ type: "error", text: t("procurement_load_error") }));
    isDevicePaired().then(setDevicePaired).catch(() => setDevicePaired(false));
  }, []);

  async function run(action, successKey) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result?.error) throw new Error(result.error);
      await reload();
      setMessage({ type: "success", text: t(successKey) });
      return true;
    } catch (error) {
      setMessage({ type: "error", text: `${t("error_prefix")}: ${t(`err_${error.message}`)}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="rk-page-heading">
        <div>
          <h2>{t("procurement_title")}</h2>
          <p>{t("procurement_subtitle")}</p>
        </div>
        <span className="rk-badge success">{t("audited_workflow")}</span>
      </div>

      {message && <div className={`rk-alert ${message.type}`}>{message.text}</div>}

      {user.role === "admin" && (
        <div className="rk-grid" style={{ marginBottom: 18 }}>
          <SupplierForm
            busy={busy}
            t={t}
            onSubmit={(payload) => run(() => createSupplier(payload), "supplier_created")}
          />
          <PurchaseOrderForm
            suppliers={suppliers.filter((supplier) => supplier.status === "active")}
            parts={parts}
            branches={branches}
            busy={busy}
            t={t}
            onSubmit={(payload) => run(() => createPurchaseOrder(payload), "purchase_order_created")}
          />
        </div>
      )}

      <div className="rk-card">
        <div className="rk-page-heading">
          <div>
            <h3>{t("purchase_orders")}</h3>
            <p>{t("purchase_orders_hint")}</p>
          </div>
        </div>
        {!orders.length ? (
          <p>{t("no_purchase_orders")}</p>
        ) : (
          <div className="rk-table-wrap">
            <table className="rk-table">
              <thead>
                <tr>
                  <th>{t("po_number")}</th>
                  <th>{t("supplier")}</th>
                  <th>{t("col_branch")}</th>
                  <th>{t("status_label")}</th>
                  <th>{t("items_and_receipts")}</th>
                  <th>{t("total_label")}</th>
                  <th>{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <PurchaseOrderRow
                    key={order.id}
                    order={order}
                    user={user}
                    busy={busy}
                    t={t}
                    devicePaired={devicePaired}
                    run={run}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SupplierForm({ busy, onSubmit, t }) {
  const [form, setForm] = useState({ name: "", vatNumber: "", phone: "", email: "", paymentTermsDays: 0 });

  async function submit(event) {
    event.preventDefault();
    if (await onSubmit(form)) setForm({ name: "", vatNumber: "", phone: "", email: "", paymentTermsDays: 0 });
  }

  return (
    <form className="rk-card" onSubmit={submit}>
      <h3>{t("add_supplier")}</h3>
      <div className="rk-form-grid">
        <input className="rk-input" required placeholder={t("supplier_name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="rk-input" inputMode="numeric" maxLength={15} placeholder={t("vat_number_optional")} value={form.vatNumber} onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} />
        <input className="rk-input" placeholder={t("phone_optional")} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        <input className="rk-input" type="email" placeholder={t("email_optional")} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <label className="rk-field-label">
          {t("payment_terms_days")}
          <input className="rk-input" type="number" min="0" max="3650" value={form.paymentTermsDays} onChange={(e) => setForm({ ...form, paymentTermsDays: e.target.value })} />
        </label>
      </div>
      <button className="rk-btn" disabled={busy}>{t("save_supplier")}</button>
    </form>
  );
}

function PurchaseOrderForm({ suppliers, parts, branches, busy, onSubmit, t }) {
  const [supplierId, setSupplierId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);

  const total = useMemo(
    () => lines.reduce((sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0),
    [lines]
  );

  function updateLine(index, patch) {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  }

  async function submit(event) {
    event.preventDefault();
    const payload = {
      supplierId,
      branchId,
      expectedAt,
      notes,
      items: lines.map((line) => ({
        partId: Number(line.partId),
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
      })),
    };
    if (await onSubmit(payload)) {
      setExpectedAt("");
      setNotes("");
      setLines([{ ...EMPTY_LINE }]);
    }
  }

  return (
    <form className="rk-card rk-card-wide" onSubmit={submit}>
      <h3>{t("new_purchase_order")}</h3>
      <div className="rk-form-grid">
        <select className="rk-select" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">{t("choose_supplier")}</option>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select>
        <select className="rk-select" required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          <option value="">{t("choose_branch")}</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <label className="rk-field-label">{t("expected_date")}<input className="rk-input" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></label>
        <input className="rk-input" placeholder={t("notes_optional")} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="rk-order-lines">
        {lines.map((line, index) => (
          <div className="rk-order-line" key={index}>
            <select className="rk-select" required value={line.partId} onChange={(e) => updateLine(index, { partId: e.target.value })}>
              <option value="">{t("choose_part")}</option>
              {parts.map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.name}</option>)}
            </select>
            <input className="rk-input" required type="number" min="1" step="1" placeholder={t("quantity")} value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} />
            <input className="rk-input" required type="number" min="0" step="0.01" placeholder={t("unit_cost")} value={line.unitCost} onChange={(e) => updateLine(index, { unitCost: e.target.value })} />
            {lines.length > 1 && <button type="button" className="rk-btn-outline" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>}
          </div>
        ))}
      </div>
      <div className="rk-actions-row">
        <button type="button" className="rk-btn-outline" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>{t("add_line")}</button>
        <strong>{t("total_label")}: {total.toLocaleString(undefined, { maximumFractionDigits: 2 })} {t("sar")}</strong>
        <button className="rk-btn" disabled={busy || !suppliers.length || !parts.length || !branches.length}>{t("create_draft")}</button>
      </div>
    </form>
  );
}

function PurchaseOrderRow({ order, user, busy, run, t, devicePaired }) {
  const items = Array.isArray(order.items) ? order.items : [];
  const receivable = ["approved", "partially_received"].includes(order.status);
  const remainingItems = items.filter((item) => Number(item.receivedQuantity) < Number(item.orderedQuantity));
  const [receiving, setReceiving] = useState(false);
  const [quantities, setQuantities] = useState({});
  const [receiptReference, setReceiptReference] = useState(() => crypto.randomUUID());

  function statusLabel(status) {
    return t(`po_status_${status}`);
  }

  async function receive() {
    const receiptItems = remainingItems
      .map((item) => ({ purchaseOrderItemId: item.id, quantity: Number(quantities[item.id] || 0) }))
      .filter((item) => item.quantity > 0);
    if (!receiptItems.length) return;
    if (await run(() => receivePurchaseOrder(order.id, receiptItems, "", receiptReference), "purchase_receipt_created")) {
      setReceiving(false);
      setQuantities({});
      setReceiptReference(crypto.randomUUID());
    }
  }

  return (
    <tr>
      <td><strong>{order.po_number}</strong><br /><small>{new Date(order.created_at).toLocaleDateString()}</small></td>
      <td>{order.supplier_name}</td>
      <td>{order.branch_name}</td>
      <td><span className={`rk-badge ${STATUS_CLASS[order.status] || ""}`}>{statusLabel(order.status)}</span></td>
      <td>
        {items.map((item) => (
          <div key={item.id} className="rk-line-summary">
            <span>{item.partNumber} — {item.partName}</span>
            <strong>{item.receivedQuantity}/{item.orderedQuantity}</strong>
          </div>
        ))}
      </td>
      <td>{Number(order.subtotal).toLocaleString(undefined, { maximumFractionDigits: 2 })} {t("sar")}</td>
      <td>
        <div className="rk-actions-stack">
          {user.role === "admin" && order.status === "draft" && (
            <button className="rk-btn" disabled={busy} onClick={() => run(() => approvePurchaseOrder(order.id), "purchase_order_approved")}>{t("approve")}</button>
          )}
          {user.role === "admin" && ["draft", "approved"].includes(order.status) && (
            <button className="rk-btn-outline" disabled={busy} onClick={() => run(() => cancelPurchaseOrder(order.id), "purchase_order_cancelled")}>{t("cancel_order")}</button>
          )}
          {receivable && (
            <button className="rk-btn-outline" disabled={busy} onClick={() => setReceiving((value) => !value)}>{t("receive_stock")}</button>
          )}
          {receiving && (
            <div className="rk-receipt-panel">
              {!devicePaired && <p className="rk-text-danger">{t("pair_device_to_receive")}</p>}
              {remainingItems.map((item) => {
                const remaining = Number(item.orderedQuantity) - Number(item.receivedQuantity);
                return (
                  <label key={item.id} className="rk-field-label">
                    {item.partNumber} ({t("remaining")}: {remaining})
                    <input className="rk-input" type="number" min="0" max={remaining} step="1" value={quantities[item.id] || ""} onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })} />
                  </label>
                );
              })}
              <button className="rk-btn" disabled={busy || !devicePaired} onClick={receive}>{t("confirm_receipt")}</button>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
