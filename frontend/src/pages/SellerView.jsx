import React, { useEffect, useState } from "react";
import { searchParts, checkout, isDevicePaired, pairDevice } from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function SellerView({ user }) {
  const { t } = useLanguage();
  const [q, setQ] = useState("");
  const [type, setType] = useState("name");
  const [results, setResults] = useState([]);
  const [cart, setCart] = useState([]); // { partId, name, price, quantity }
  const [paired, setPaired] = useState(false);
  const [pairingCode, setPairingCode] = useState("");

  useEffect(() => { isDevicePaired().then(setPaired).catch(() => setPaired(false)); }, []);

  async function onSearch() {
    setResults(await searchParts(q, type));
  }

  function addToCart(p) {
    setCart((c) => {
      const line = c.find((x) => x.partId === p.id);
      if (line) return c.map((x) => (x.partId === p.id ? { ...x, quantity: x.quantity + 1 } : x));
      return [...c, { partId: p.id, name: p.name, price: Number(p.price), quantity: 1 }];
    });
  }

  const subtotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const total = subtotal * 1.15;

  async function onCheckout() {
    const items = cart.map((c) => ({ partId: c.partId, quantity: c.quantity }));
    const invoice = await checkout(user?.branchId, items);
    if (invoice.error) {
      alert(`${t("error_prefix")}: ${invoice.error}`);
      return;
    }
    alert(`${t("invoice_issued")} ${invoice.invoice_number}`);
    setCart([]);
    onSearch();
  }

  async function connectDevice() {
    const result = await pairDevice(pairingCode.trim());
    if (result.device) setPaired(true);
    else alert(result.error || "تعذر ربط الجهاز");
  }

  if (!paired) {
    return (
      <div className="rk-card">
        <h3>ربط جهاز نقطة البيع</h3>
        <p>اطلب من مدير المحل إنشاء رمز ربط لهذا الجهاز.</p>
        <input className="rk-input" maxLength={6} value={pairingCode} onChange={(e) => setPairingCode(e.target.value)} placeholder="رمز الربط المكون من 6 أرقام" />
        <button className="rk-btn" style={{ marginTop: 10 }} onClick={connectDevice}>ربط الجهاز</button>
      </div>
    );
  }

  return (
    <div>
      <div className="rk-card" style={{ marginBottom: 12 }}>
        الموظف المسؤول عن الصرف: <b>{user?.name || "المستخدم المسجل"}</b>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
      <div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="name">{t("search_by_name")}</option>
            <option value="pn">{t("search_by_pn")}</option>
            <option value="vin">{t("search_by_vin")}</option>
          </select>
          <input className="rk-input" style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("seller_search_placeholder")} />
          <button className="rk-btn" onClick={onSearch}>{t("search_btn")}</button>
        </div>
        <table width="100%">
          <thead>
            <tr>
              <th>{t("col_part")}</th>
              <th>{t("col_price")}</th>
              <th>{t("col_location")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>
                  {p.price} {t("sar")}
                </td>
                <td style={{ fontSize: 12 }}>
                  {p.inventory?.[0] ? `📍 قسم ${p.inventory[0].shelf_section} رف ${p.inventory[0].shelf_number}` : "-"}
                </td>
                <td>
                  <button className="rk-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => addToCart(p)}>{t("add_btn")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rk-card">
        <h3>{t("invoice_title")}</h3>
        {cart.map((c) => (
          <div key={c.partId} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span>{c.name} × {c.quantity}</span>
            <span>{(c.price * c.quantity).toFixed(2)}</span>
          </div>
        ))}
        <hr />
        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
          <span>{t("total_incl_vat")}</span>
          <span>
            {total.toFixed(2)} {t("sar")}
          </span>
        </div>
        <button className="rk-btn" style={{ width: "100%", marginTop: 10 }} onClick={onCheckout} disabled={!cart.length}>
          {t("checkout_btn")}
        </button>
      </div>
      </div>
    </div>
  );
}
