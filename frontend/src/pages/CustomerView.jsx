import React, { useEffect, useState } from "react";
import { deleteVehicle, getVehicles, saveVehicle, searchParts, checkoutOnline } from "../api/client.js";
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
  const [paymentReference, setPaymentReference] = useState("");
  const [lastInvoice, setLastInvoice] = useState(null);
  const [paymentError, setPaymentError] = useState("");
  const [vehicles, setVehicles] = useState([]);
  const [vehicleMessage, setVehicleMessage] = useState("");
  const [vehicle, setVehicle] = useState({ vin: "", nickname: "", make: "", model: "", modelYear: "", engine: "", trim: "", plateNumber: "" });

  function refreshVehicles() {
    getVehicles().then((data) => setVehicles(Array.isArray(data) ? data : []));
  }

  useEffect(refreshVehicles, []);

  async function onSearch() {
    if (!q.trim()) return;
    const data = await searchParts(q, type);
    if (data.error) {
      setPaymentError(`تعذر البحث: ${data.error}`);
      setResults([]);
      return;
    }
    setPaymentError("");
    setResults(Array.isArray(data) ? data : []);
  }

  async function onSaveVehicle() {
    const result = await saveVehicle({ ...vehicle, modelYear: Number(vehicle.modelYear) });
    if (result.error) {
      setVehicleMessage(`تعذر حفظ السيارة: ${result.error}`);
      return;
    }
    setVehicleMessage("تم حفظ السيارة. يمكنك البحث برقم الهيكل مستقبلاً دون إعادة إدخالها.");
    setVehicle({ vin: "", nickname: "", make: "", model: "", modelYear: "", engine: "", trim: "", plateNumber: "" });
    refreshVehicles();
  }

  async function onDeleteVehicle(id) {
    const result = await deleteVehicle(id);
    if (result.error) return setVehicleMessage(`تعذر حذف السيارة: ${result.error}`);
    refreshVehicles();
  }

  function searchSavedVehicle(saved) {
    setType("vin");
    setQ(saved.vin);
    searchParts(saved.vin, "vin").then((data) => {
      if (data.error) {
        setPaymentError(`تعذر البحث: ${data.error}`);
        setResults([]);
      } else {
        setPaymentError("");
        setResults(Array.isArray(data) ? data : []);
      }
    });
  }

  function addToCart(p) {
    const branchId = p.inventory?.[0]?.branch_id;
    if (!branchId) return;
    if (cart.length && String(cart[0].branchId) !== String(branchId)) {
      setPaymentError("يجب أن تكون جميع قطع الطلب من فرع واحد. أفرغ السلة ثم اختر قطع الفرع الآخر.");
      return;
    }
    setPaymentError("");
    setCart((c) => {
      const line = c.find((x) => x.partId === p.id);
      if (line) return c.map((x) => (x.partId === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [...c, { partId: p.id, name: p.name, price: Number(p.price), quantity: 1, branchId }];
    });
  }

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const total = subtotal * 1.15;

  useEffect(() => {
    const paymentId = new URLSearchParams(window.location.search).get("id");
    const rawPending = sessionStorage.getItem("rakaez_pending_payment");
    if (!paymentId || !rawPending) return;
    let pending;
    try {
      pending = JSON.parse(rawPending);
    } catch {
      sessionStorage.removeItem("rakaez_pending_payment");
      return;
    }
    if (pending.purpose !== "online_order" || String(pending.userId) !== String(user.id)) return;
    checkoutOnline(pending.branchId, pending.items, paymentId, pending.requestReference)
      .then((invoice) => {
        if (!invoice.error) {
          setLastInvoice(invoice);
          setCart([]);
          sessionStorage.removeItem("rakaez_pending_payment");
          window.history.replaceState({}, "", window.location.pathname);
        } else {
          setPaymentError(`${t("payment_registered_error")}: ${invoice.error}. احتفظ بمرجع الدفع وتواصل مع الدعم.`);
        }
      })
      .catch(() => setPaymentError("تعذر الاتصال بالخادم للتحقق من الدفعة. احتفظ بمرجع الدفع وأعد المحاولة."));
  }, [t, user.id]);

  async function onPaymentCompleted(payment) {
    setPaying(false);
    if (payment.status === "initiated") return;
    if (payment.status !== "paid" && payment.status !== "captured") {
      alert(t("payment_incomplete") + ": " + payment.status);
      return;
    }
    // all cart items must currently come from a single branch in this MVP
    const branchId = cart[0]?.branchId;
    let invoice;
    try {
      invoice = await checkoutOnline(
        branchId,
        cart.map((c) => ({ partId: c.partId, quantity: c.quantity })),
        payment.id,
        paymentReference
      );
    } catch {
      setPaymentError("تعذر الاتصال بالخادم للتحقق من الدفعة. احتفظ بمرجع الدفع وأعد المحاولة.");
      return;
    }
    if (invoice.error) {
      setPaymentError(`${t("payment_registered_error")}: ${invoice.error} — ${t("contact_support")}.`);
      return;
    }
    sessionStorage.removeItem("rakaez_pending_payment");
    setLastInvoice(invoice);
    setCart([]);
    onSearch();
  }

  function beginPayment() {
    setPaymentError("");
    const requestReference = crypto.randomUUID();
    const branchId = cart[0]?.branchId;
    const items = cart.map((c) => ({ partId: c.partId, quantity: c.quantity }));
    setPaymentReference(requestReference);
    sessionStorage.setItem("rakaez_pending_payment", JSON.stringify({
      purpose: "online_order",
      requestReference,
      branchId,
      items,
      userId: user.id,
    }));
    setPaying(true);
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
      <div className="rk-card" style={{ marginBottom: 16 }}>
        <h3>سياراتي المحفوظة</h3>
        <p style={{ fontSize: 13, color: "#666" }}>احفظ بيانات السيارة مرة واحدة، ثم ابحث عن القطع المتوافقة برقم الهيكل بضغطة واحدة.</p>
        {vehicles.map((saved) => (
          <div key={saved.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <span><b>{saved.nickname || `${saved.make} ${saved.model}`}</b> — <span dir="ltr">{saved.vin}</span> — {saved.model_year}</span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="rk-btn-outline" onClick={() => searchSavedVehicle(saved)}>ابحث عن القطع</button>
              <button className="rk-btn-outline" onClick={() => onDeleteVehicle(saved.id)}>حذف</button>
            </span>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
          <input className="rk-input" dir="ltr" maxLength={17} value={vehicle.vin} onChange={(e) => setVehicle((v) => ({ ...v, vin: e.target.value.toUpperCase() }))} placeholder="VIN رقم الهيكل (17 خانة)" />
          <input className="rk-input" maxLength={100} value={vehicle.nickname} onChange={(e) => setVehicle((v) => ({ ...v, nickname: e.target.value }))} placeholder="اسم مختصر: سيارة محمد" />
          <input className="rk-input" maxLength={100} value={vehicle.make} onChange={(e) => setVehicle((v) => ({ ...v, make: e.target.value }))} placeholder="الشركة: Toyota" />
          <input className="rk-input" maxLength={100} value={vehicle.model} onChange={(e) => setVehicle((v) => ({ ...v, model: e.target.value }))} placeholder="الموديل: Camry" />
          <input className="rk-input" type="number" min="1900" max="2200" value={vehicle.modelYear} onChange={(e) => setVehicle((v) => ({ ...v, modelYear: e.target.value }))} placeholder="سنة الموديل" />
          <input className="rk-input" maxLength={100} value={vehicle.engine} onChange={(e) => setVehicle((v) => ({ ...v, engine: e.target.value }))} placeholder="المحرك (اختياري)" />
        </div>
        <button className="rk-btn" style={{ marginTop: 8 }} disabled={vehicle.vin.length !== 17 || !vehicle.make.trim() || !vehicle.model.trim() || !vehicle.modelYear} onClick={onSaveVehicle}>حفظ السيارة</button>
        {vehicleMessage && <p>{vehicleMessage}</p>}
      </div>
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
        <button className="rk-btn" disabled={!q.trim()} onClick={onSearch}>{t("search_btn")}</button>
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
                📍 متوفر في {inv.branch_name}
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
          {paymentError && (
            <div style={{ padding: 10, marginBottom: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>
              {paymentError}
            </div>
          )}
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
            <button className="rk-btn" style={{ width: "100%", marginTop: 10 }} onClick={beginPayment}>
              {t("pay_online")}
            </button>
          ) : (
            <div style={{ marginTop: 12 }}>
              <MoyasarCheckout
                amountSar={total}
                description={`طلب ركائز - ${cart.length} صنف`}
                paymentMetadata={{
                  rakaez_purpose: "online_order",
                  rakaez_request_reference: paymentReference,
                  rakaez_organization_id: String(user.organizationId),
                  rakaez_user_id: String(user.id),
                }}
                onCompleted={onPaymentCompleted}
                onCancel={() => {
                  setPaying(false);
                  setPaymentReference("");
                  sessionStorage.removeItem("rakaez_pending_payment");
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
