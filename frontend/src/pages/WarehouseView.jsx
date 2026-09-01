import React, { useEffect, useState } from "react";
import {
  findWarehouseParts,
  getAllParts,
  getWarehouseLowStock,
  issueInventory,
  isDevicePaired,
  pairDevice,
} from "../api/client.js";

const MATCH_TYPE_LABELS = {
  barcode: "تطابق الباركود",
  part_number: "تطابق رقم القطعة",
  shelf: "تطابق رقم الرف",
  text: "تطابق الاسم أو الوصف",
};

export default function WarehouseView({ user }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [paired, setPaired] = useState(false);
  const [code, setCode] = useState("");
  const [shelfCode, setShelfCode] = useState("");
  const [shelfResult, setShelfResult] = useState(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [showingLowStock, setShowingLowStock] = useState(false);

  useEffect(() => { isDevicePaired().then(setPaired).catch(() => setPaired(false)); }, []);
  useEffect(() => {
    if (paired) getAllParts().then((data) => setParts(Array.isArray(data) ? data : []));
  }, [paired]);

  async function connect() {
    const result = await pairDevice(code.trim());
    if (result.device) setPaired(true);
    else setMessage(result.error || "تعذر ربط الجهاز");
  }

  async function issue() {
    const result = await issueInventory(partId, Number(quantity), note.trim());
    setMessage(result.error ? `تعذر الصرف: ${result.error}` : `تم الصرف باسم ${user?.name}. المتبقي: ${result.remainingQuantity}`);
    if (!result.error) {
      setQuantity(1);
      setNote("");
      setShelfResult((current) => current ? {
        ...current,
        parts: current.parts.map((part) => String(part.id) === String(partId)
          ? { ...part, quantity: result.remainingQuantity }
          : part),
      } : current);
    }
  }

  async function lookupShelf() {
    setLookingUp(true);
    setShowingLowStock(false);
    try {
      const result = await findWarehouseParts(shelfCode.trim());
      if (result.error) {
        setMessage(`تعذر البحث: ${result.error}`);
        setShelfResult(null);
        return;
      }
      setMessage(result.count ? `تم العثور على ${result.count} نتيجة` : "لا توجد قطعة مطابقة في هذا الفرع");
      setShelfResult(result);
    } catch {
      setMessage("تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.");
      setShelfResult(null);
    } finally {
      setLookingUp(false);
    }
  }

  async function loadLowStock() {
    setLookingUp(true);
    try {
      const result = await getWarehouseLowStock();
      if (result.error) {
        setMessage(`تعذر عرض النواقص: ${result.error}`);
        setShelfResult(null);
        setShowingLowStock(false);
        return;
      }
      setShelfResult(result);
      setShowingLowStock(true);
      setMessage(result.count ? `${result.count} قطعة بلغت حد إعادة الطلب` : "لا توجد نواقص في هذا الفرع");
    } catch {
      setMessage("تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.");
      setShelfResult(null);
      setShowingLowStock(false);
    } finally {
      setLookingUp(false);
    }
  }

  if (!paired) {
    return <div className="rk-card"><h3>ربط جهاز المستودع</h3><input className="rk-input" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} placeholder="رمز الربط من المدير" /><button className="rk-btn" style={{ marginTop: 10 }} onClick={connect}>ربط الجهاز</button>{message && <p>{message}</p>}</div>;
  }

  return (
    <div>
    <div className="rk-card" style={{ marginBottom: 16 }}>
      <h3>البحث الذكي في مخزون الفرع</h3>
      <p>ابحث برقم الرف أو رقم القطعة أو الباركود أو اسم القطعة.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="rk-input"
          value={shelfCode}
          onChange={(e) => { setShelfCode(e.target.value); setShelfResult(null); setShowingLowStock(false); }}
          onKeyDown={(e) => { if (e.key === "Enter" && shelfCode.trim() && !lookingUp) lookupShelf(); }}
          placeholder="A-15 أو الباركود أو رقم القطعة"
        />
        <button className="rk-btn" disabled={!shelfCode.trim() || lookingUp} onClick={lookupShelf}>
          {lookingUp ? "جاري البحث..." : "بحث"}
        </button>
        <button className="rk-btn-outline" disabled={lookingUp} onClick={loadLowStock}>ناقص المخزون</button>
      </div>
      {showingLowStock && <h4 style={{ marginTop: 14 }}>تنبيهات إعادة الطلب</h4>}
      {shelfResult?.parts?.map((part) => (
        <button
          key={part.id}
          type="button"
          className="rk-card"
          onClick={() => setPartId(String(part.id))}
          style={{
            width: "100%", textAlign: "right", marginTop: 8, cursor: "pointer",
            borderColor: String(part.id) === String(partId) ? "var(--rakaez-gold)" : undefined,
          }}
        >
          <b>{part.part_number} — {part.name}</b>
          <div>الكمية: {part.quantity} | الموقع: {[part.shelf_section, part.shelf_number, part.shelf_level].filter(Boolean).join(" / ")}</div>
          {part.barcode && <div>الباركود: {part.barcode}</div>}
          {showingLowStock && <div style={{ color: "#b91c1c" }}>الحد الأدنى: {part.min_quantity}</div>}
          {!showingLowStock && part.match_type && (
            <div style={{ fontSize: 12 }}>{MATCH_TYPE_LABELS[part.match_type] || "نتيجة مطابقة"}</div>
          )}
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
