import React, { useState } from "react";
import { searchParts, checkoutOnline } from "../api/client.js";
import MoyasarCheckout from "../components/MoyasarCheckout.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function CustomerView({ user }) {
  const paymentsEnabled = import.meta.env.VITE_PAYMENTS_ENABLED === "true";
  const { t } = useLanguage();
  const [q, setQ] = useState("");
  const [type, setType] = useState("name");
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]); // { partId, name, price, quantity, branchId }
  const [paying, setPaying] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(null);

  async function onSearch() {
    setResults(await searchParts(q, type));
  }

  function addToCart(p) {
    const branchId = p.inventory?.[0]?.branch_id;
    if (!branchId) return;
    setCart((c) => {
      const line = c.find((x) => x.partId === p.id);
      if (line) return c.map((x) => (x.partId === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [...c, { partId: p.id, name: p.name, price: Number(p.price), quantity: 1, branchId }];
    });
  }

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const total = subtotal * 1.15;

  async function onPaymentCompleted(payment) {
    setPaying(false);
    if (payment.status !== "paid") {
      alert(t("payment_incomplete") + ": " + payment.status);
      return;
    }
    // all cart items must currently come from a single branch in this MVP
    const branchId = cart[0]?.branchId;
    const invoice = await checkoutOnline(
      branchId,
      cart.map((c) => ({ partId: c.partId, quantity: c.quantity })),
      payment.source?.token || payment.id
    );
    if (invoice.error) {
      alert(`${t("payment_registered_error")}: ${invoice.error} — ${t("contact_support")}.`);
      return;
    }
    setLastInvoice(invoice);
    setCart([]);
    onSearch();
  }

  if (!user) {
    return <div style={{ padding: 20, color: "#777" }}>{t("please_login")}</div>;
  }

  if (lastInvoice) {
    return (
      <div style={{ maxWidth: 420, margin: "40px auto", textAlign: "center" }}>
        <h2>{t("order_confirmed")}</h2>
        <p>
          {t("invoice_number")}: {lastInvoice.invoice_number}
        </p>
        <p>
          {t("total_label")}: {Number(lastInvoice.total).toFixed(2)} {t("sar")}
        </p>
        <button onClick={() => setLastInvoice(null)}>{t("continue_shopping")}</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="name">{t("search_by_name")}</option>
          <option value="pn">{t("search_by_pn")}</option>
          <option value="vin">{t("search_by_vin")}</option>
        </select>
        <input
          className="rk-input"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_placeholder")}
        />
        <button className="rk-btn" onClick={onSearch}>{t("search_btn")}</button>
      </div>

      <div className="rk-grid">
        {results.map((p) => (
          <div key={p.id} className="rk-card">
            <b>{p.name}</b>
            <div style={{ fontSize: 12, color: "#6b5a3f" }}>{p.brand} · {p.id}</div>
            <div style={{ margin: "8px 0", color: "var(--rakaez-gold-dark)", fontWeight: 700 }}>
              {p.price} {t("sar")}
            </div>
            {p.inventory?.map((inv) => (
              <div key={inv.id} style={{ fontSize: 12 }}>
                📍 {inv.branch_name} — قسم {inv.shelf_section} رف {inv.shelf_number} ({inv.shelf_level}) — الكمية: {inv.quantity}
              </div>
            ))}
            <button className="rk-btn" style={{ marginTop: 8, width: "100%" }} onClick={() => addToCart(p)} disabled={!p.inventory?.length}>
              {t("add_to_cart")}
            </button>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="rk-card" style={{ marginTop: 20 }}>
          <h3>{t("cart")}</h3>
          {cart.map((c) => (
            <div key={c.partId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span>{c.name} × {c.quantity}</span>
              <span>
                {(c.price * c.quantity).toFixed(2)} {t("sar")}
              </span>
            </div>
          ))}
          <hr />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
            <span>{t("total_incl_vat")}</span>
            <span>
              {total.toFixed(2)} {t("sar")}
            </span>
          </div>

          {!paymentsEnabled ? (
            <div style={{ padding: 10, marginTop: 10, background: "#fffbeb", borderRadius: 8 }}>
              الطلب الإلكتروني غير متاح في النسخة التجريبية. يمكنك البحث والتواصل مع المحل.
            </div>
          ) : !paying ? (
            <button className="rk-btn" style={{ width: "100%", marginTop: 10 }} onClick={() => setPaying(true)}>
              {t("pay_online")}
            </button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <MoyasarCheckout
                amountSar={total}
                description={`طلب ركائز - ${cart.length} صنف`}
                onCompleted={onPaymentCompleted}
                onCancel={() => setPaying(false)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
