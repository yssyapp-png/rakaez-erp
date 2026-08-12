import React, { useEffect, useState } from "react";
import { findPartsByShelf, getAllParts, issueInventory, isDevicePaired, pairDevice } from "../api/client.js";

export default function WarehouseView({ user }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [paired, setPaired] = useState(isDevicePaired());
  const [code, setCode] = useState("");
  const [shelfCode, setShelfCode] = useState("");
  const [shelfResult, setShelfResult] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);

  useEffect(() => {
    if (paired) getAllParts().then((data) => setParts(Array.isArray(data) ? data : []));
  }, [paired]);

  async function connect() {
    const result = await pairDevice(code.trim());
    if (result.deviceToken) setPaired(true);
    else setMessage(result.error || "تعذر ربط الجهاز");
  }

  async function issue() {
    const result = await issueInventory(partId, Number(quantity), note.trim());
    setMessage(result.error ? `تعذر الصرف: ${result.error}` : `تم الصرف باسم ${user?.name}. المتبقي: ${result.remainingQuantity}`);
    if (!result.error) { setQuantity(1); setNote(""); }
  }

  async function lookupShelf() {
    setLookingUp(true);
    const result = await findPartsByShelf(shelfCode.trim());
    setLookingUp(false);
    if (result.error) {
      setMessage(`تعذر البحث: ${result.error}`);
      setShelfResult(null);
      return;
    }
    setMessage(result.count ? `تم العثور على ${result.count} قطعة في الرف` : "لا توجد قطع مسجلة على هذا الرف");
    setShelfResult(result);
  }

  if (!paired) {
    return <div className="rk-card"><h3>ربط جهاز المستودع</h3><input className="rk-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="رمز الربط من المدير" /><button className="rk-btn" style={{ marginTop: 10 }} onClick={connect}>ربط الجهاز</button>{message && <p>{message}</p>}</div>;
  }

  return (
    <div>
    <div className="rk-card" style={{ marginBottom: 16 }}>
      <h3>العثور على القطعة برقم الرف</h3>
      <p>اكتب الرقم الموجود على الرف، مثل <b>A-15</b> أو <b>15</b>.</p>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="rk-input" value={shelfCode} onChange={(e) => { setShelfCode(e.target.value); setShelfResult(null); }} placeholder="رقم الرف" />
        <button className="rk-btn" disabled={!shelfCode.trim() || lookingUp} onClick={lookupShelf}>
          {lookingUp ? "جاري البحث..." : "بحث"}
        </button>
      </div>
      {shelfResult?.parts?.map((part) => (
        <button
          key={part.id}
          type="button"
          className="rk-card"
          onClick={() => setPartId(String(part.id))}
          style={{ width: "100%", textAlign: "right", marginTop: 8, cursor: "pointer" }}
        >
          <b>{part.part_number} — {part.name}</b>
          <div>الكمية: {part.quantity} | الموقع: {[part.shelf_section, part.shelf_number, part.shelf_level].filter(Boolean).join(" / ")}</div>
          {part.barcode && <div>الباركود: {part.barcode}</div>}
        </button>
      ))}
    </div>
    <div className="rk-card">
      <h3>صرف من المستودع</h3>
      <p>مأمور المستودع المسؤول: <b>{user?.name}</b></p>
      <select className="rk-select" value={partId} onChange={(e) => setPartId(e.target.value)}>
        <option value="">اختر القطعة</option>
        {parts.map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.name}</option>)}
      </select>
      <input className="rk-input" style={{ marginTop: 10 }} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="الكمية" />
      <input className="rk-input" style={{ marginTop: 10 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الصرف أو الجهة المستلمة" />
      <button className="rk-btn" style={{ marginTop: 10 }} disabled={!partId || Number(quantity) < 1} onClick={issue}>تأكيد الصرف باسمي</button>
      {message && <p>{message}</p>}
    </div>
    </div>
  );
}
