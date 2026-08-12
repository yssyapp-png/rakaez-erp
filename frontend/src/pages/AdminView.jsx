import React, { useEffect, useState } from "react";
import {
  createDevicePairingCode,
  createBranch,
  createInvitation,
  getAdminStats,
  getBranchesSummary,
  getDevices,
  getInvoices,
  getInventoryMovements,
  getOrganization,
  revokeDevice,
  previewSaudiStarterCatalog,
  importSaudiStarterCatalog,
  updateOrganization,
} from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

function TrialBanner({ org, t }) {
  if (!org) return null;
  if (org.subscription_status === "trialing" && org.trial_ends_at) {
    const daysLeft = Math.max(0, Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000));
    return (
      <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        {t("trial_ends_in")} <b>{org.name}</b> {t("ends_within")} <b>{daysLeft}</b> {t("days")} — {t("current_plan")}: {org.plan}.
      </div>
    );
  }
  if (org.subscription_status === "past_due") {
    return (
      <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        {t("payment_overdue")} <b>{org.name}</b> — {t("update_payment_notice")}.
      </div>
    );
  }
  return null;
}

export default function AdminView() {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  const [branches, setBranches] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [org, setOrg] = useState(null);
  const [devices, setDevices] = useState([]);
  const [movements, setMovements] = useState([]);

  useEffect(() => {
    getAdminStats().then(setStats);
    getBranchesSummary().then(setBranches);
    getInvoices().then(setInvoices);
    getOrganization().then(setOrg);
    getDevices().then((data) => setDevices(Array.isArray(data) ? data : []));
    getInventoryMovements().then((data) => setMovements(Array.isArray(data) ? data : []));
  }, []);

  if (!stats) return <p>{t("loading")}</p>;

  return (
    <div>
      <TrialBanner org={org} t={t} />
      {org?.login_code && (
        <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 8, padding: 12, marginBottom: 16 }}>
          {t("organization_code")}: <b dir="ltr">{org.login_code}</b>
        </div>
      )}
      <OrganizationSettings org={org} onUpdated={() => getOrganization().then(setOrg)} />
      <BranchManagement branches={branches} onChanged={() => getBranchesSummary().then(setBranches)} />
      <DeviceManagement branches={branches} devices={devices} onDevicesChanged={() => getDevices().then(setDevices)} />
      <EmployeeInvitations branches={branches} />
      <SaudiCatalogImport />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: "#777" }}>{t("inventory_value")}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {stats.inventoryValue.toLocaleString()} {t("sar")}
          </div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: "#777" }}>{t("total_sales")}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>
            {stats.totalSales.toLocaleString()} {t("sar")}
          </div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
          <div style={{ fontSize: 12, color: "#777" }}>{t("low_stock_items")}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#f59e0b" }}>{stats.lowStock.length}</div>
        </div>
      </div>

      <h3>{t("inventory_by_branch")}</h3>
      <table width="100%">
        <thead>
          <tr>
            <th>{t("col_branch")}</th>
            <th>{t("col_item_count")}</th>
            <th>{t("inventory_value")}</th>
            <th>{t("col_low_stock")}</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.id}>
              <td>{b.name}</td>
              <td>{b.part_count}</td>
              <td>
                {Number(b.inventory_value).toLocaleString()} {t("sar")}
              </td>
              <td>{b.low_stock_count}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{t("recent_invoices")}</h3>
      <table width="100%">
        <thead>
          <tr>
            <th>{t("invoice_number")}</th>
            <th>{t("col_branch")}</th>
            <th>{t("total_label")}</th>
            <th>{t("col_payment")}</th>
            <th>{t("col_zatca_status")}</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>{i.invoice_number}</td>
              <td>{i.branch_name}</td>
              <td>
                {Number(i.total).toFixed(2)} {t("sar")}
              </td>
              <td>{i.payment_status}</td>
              <td>{i.zatca_status === "generated_locally" ? t("zatca_ready_note") : i.zatca_status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "#777" }}>{t("zatca_footnote")}</p>
      <h3>سجل الصرف وحركات المخزون</h3>
      <table width="100%">
        <thead><tr><th>الوقت</th><th>الموظف</th><th>الجهاز</th><th>الفرع</th><th>القطعة</th><th>الحركة</th><th>الكمية</th><th>الملاحظة</th></tr></thead>
        <tbody>
          {movements.map((movement) => (
            <tr key={movement.id}>
              <td>{new Date(movement.created_at).toLocaleString("ar-SA")}</td>
              <td>{movement.employee_name}</td><td>{movement.device_name || "—"}</td><td>{movement.branch_name}</td>
              <td>{movement.part_number} — {movement.part_name}</td><td>{movement.movement_type}</td>
              <td>{movement.quantity_change}</td><td>{movement.note || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OrganizationSettings({ org, onUpdated }) {
  const [name, setName] = useState(org?.name || "");
  const [vatNumber, setVatNumber] = useState(org?.vat_number || "");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setName(org?.name || "");
    setVatNumber(org?.vat_number || "");
  }, [org?.id, org?.name, org?.vat_number]);

  async function save() {
    const result = await updateOrganization(name.trim(), vatNumber.trim());
    if (result.error) return setMessage(`تعذر الحفظ: ${result.error}`);
    setMessage("تم حفظ بيانات المنشأة. أصبحت هوية الفاتورة الضريبية جاهزة.");
    onUpdated();
  }

  return (
    <section className="rk-card" style={{ marginBottom: 20 }}>
      <h3>بيانات المنشأة والفاتورة الضريبية</h3>
      {!/^\d{15}$/.test(vatNumber) && <p style={{ color: "#b91c1c" }}>لن يسمح النظام بإصدار فاتورة حتى إدخال الرقم الضريبي الصحيح المكوّن من 15 رقمًا.</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="rk-input" maxLength={200} value={name} onChange={(e) => setName(e.target.value)} placeholder="الاسم القانوني للمنشأة" />
        <input className="rk-input" dir="ltr" inputMode="numeric" maxLength={15} value={vatNumber} onChange={(e) => setVatNumber(e.target.value.replace(/\D/g, ""))} placeholder="الرقم الضريبي (15 رقمًا)" />
        <button className="rk-btn" disabled={!name.trim() || !/^\d{15}$/.test(vatNumber)} onClick={save}>حفظ بيانات المنشأة</button>
      </div>
      {message && <p>{message}</p>}
    </section>
  );
}

function BranchManagement({ branches, onChanged }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [message, setMessage] = useState("");

  async function create() {
    const result = await createBranch(name.trim(), city.trim());
    if (result.error) return setMessage(`تعذر إنشاء الفرع: ${result.error}`);
    setName("");
    setCity("");
    setMessage("تم إنشاء الفرع بنجاح.");
    onChanged();
  }

  return (
    <section className="rk-card" style={{ marginBottom: 20 }}>
      <h3>إدارة الفروع</h3>
      <p>{branches.map((branch) => `${branch.name}${branch.city ? ` — ${branch.city}` : ""}`).join(" | ")}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="rk-input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الفرع" />
        <input className="rk-input" maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} placeholder="المدينة" />
        <button className="rk-btn" disabled={!name.trim()} onClick={create}>إضافة فرع</button>
      </div>
      {message && <p>{message}</p>}
    </section>
  );
}

function EmployeeInvitations({ branches }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("seller");
  const [branchId, setBranchId] = useState("");
  const [result, setResult] = useState(null);
  const selectedBranch = branchId || branches[0]?.id || "";

  async function create() {
    const response = await createInvitation(
      email.trim(),
      role,
      role === "customer" ? null : selectedBranch
    );
    if (response.error) {
      setResult({ error: response.error });
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}#invite=${encodeURIComponent(response.token)}`;
    setResult({ link, expiresAt: response.invitation.expires_at });
    setEmail("");
  }

  return (
    <section className="rk-card" style={{ marginBottom: 20 }}>
      <h3>دعوة موظف أو عميل</h3>
      <p style={{ color: "#666", fontSize: 13 }}>أنشئ رابطًا صالحًا لمدة 48 ساعة. حساب الموظف سيحفظ اسمه ودوره وفرعه في كل عملية.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input className="rk-input" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="البريد الإلكتروني" />
        <select className="rk-select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="seller">بائع / كاشير</option>
          <option value="warehouse_keeper">مأمور مستودع</option>
          <option value="customer">عميل</option>
        </select>
        {role !== "customer" && (
          <select className="rk-select" value={selectedBranch} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
        <button className="rk-btn" disabled={!email.trim() || (role !== "customer" && !selectedBranch)} onClick={create}>إنشاء الدعوة</button>
      </div>
      {result?.error && <p style={{ color: "#b91c1c" }}>تعذر إنشاء الدعوة: {result.error}</p>}
      {result?.link && (
        <div style={{ marginTop: 12, padding: 10, background: "#f0fdf4", borderRadius: 8 }}>
          <b>انسخ هذا الرابط وأرسله للشخص المقصود فقط:</b>
          <div dir="ltr" style={{ overflowWrap: "anywhere", marginTop: 6 }}>{result.link}</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>ينتهي: {new Date(result.expiresAt).toLocaleString("ar-SA")}</div>
        </div>
      )}
    </section>
  );
}

function SaudiCatalogImport() {
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState("");
  async function loadPreview() { setPreview(await previewSaudiStarterCatalog()); }
  async function runImport() {
    const result = await importSaudiStarterCatalog();
    setMessage(result.error ? `تعذر الاستيراد: ${result.error}` : `أضيف ${result.inserted} قالبًا كمسودة، وتم تجاوز ${result.skipped} مكررًا.`);
  }
  return (
    <section className="rk-card" style={{ marginBottom: 20 }}>
      <h3>كتالوج السوق السعودي</h3>
      <p>يضيف قوالب القطع الأكثر تداولًا كمسودات بلا سعر وبلا مخزون. راجع رقم القطعة والتوافق والسعر قبل التفعيل.</p>
      {!preview ? <button className="rk-btn-outline" onClick={loadPreview}>معاينة الحزمة</button> : (
        <><p>عدد القوالب: {preview.count}</p><button className="rk-btn" onClick={runImport}>إضافة الحزمة بضغطة واحدة</button></>
      )}
      {message && <p>{message}</p>}
    </section>
  );
}

function DeviceManagement({ branches, devices, onDevicesChanged }) {
  const [branchId, setBranchId] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [pairingCode, setPairingCode] = useState(null);
  const selectedBranch = branchId || branches[0]?.id || "";

  async function generateCode() {
    const result = await createDevicePairingCode(selectedBranch, deviceName.trim());
    if (result.code) setPairingCode(result.code);
  }

  async function revoke(id) {
    await revokeDevice(id);
    onDevicesChanged();
  }

  return (
    <section className="rk-card" style={{ marginBottom: 20 }}>
      <h3>أجهزة الفروع</h3>
      <p style={{ color: "#666", fontSize: 13 }}>أنشئ رمزًا لمدة 10 دقائق، ثم أدخله في الجهاز المراد ربطه.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select className="rk-select" value={selectedBranch} onChange={(e) => setBranchId(e.target.value)}>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <input className="rk-input" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="اسم الجهاز، مثال: كاشير 1" />
        <button className="rk-btn" disabled={!selectedBranch || !deviceName.trim()} onClick={generateCode}>إنشاء رمز الربط</button>
      </div>
      {pairingCode && <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 6, marginTop: 12 }}>{pairingCode}</div>}
      <table width="100%" style={{ marginTop: 16 }}>
        <thead><tr><th>الجهاز</th><th>الفرع</th><th>الحالة</th><th>آخر اتصال</th><th /></tr></thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td>{device.name}</td><td>{device.branch_name}</td><td>{device.status}</td>
              <td>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString("ar-SA") : "—"}</td>
              <td>{device.status === "active" && <button className="rk-btn-outline" onClick={() => revoke(device.id)}>إلغاء الربط</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
