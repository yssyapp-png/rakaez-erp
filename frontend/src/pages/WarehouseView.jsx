import React, { useEffect, useState } from "react";
import { getAllParts, issueInventory, isDevicePaired, pairDevice } from "../api/client.js";

export default function WarehouseView({ user }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [paired, setPaired] = useState(isDevicePaired());
  const [code, setCode] = useState("");

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

  if (!paired) {
    return <div className="rk-card"><h3>ربط جهاز المستودع</h3><input className="rk-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="رمز الربط من المدير" /><button className="rk-btn" style={{ marginTop: 10 }} onClick={connect}>ربط الجهاز</button>{message && <p>{message}</p>}</div>;
  }

  return (
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
  );
}
