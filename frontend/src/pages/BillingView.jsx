import React, { useEffect, useState } from "react";
import { getBillingStatus, activateSubscription, changeBillingInterval } from "../api/client.js";
import MoyasarCheckout from "../components/MoyasarCheckout.jsx";
import { useLanguage } from "../i18n/LanguageContext.jsx";

export default function BillingView() {
  const paymentsEnabled = import.meta.env.VITE_PAYMENTS_ENABLED === "true";
  const { t } = useLanguage();
  const [status, setStatus] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [interval, setInterval] = useState("monthly"); // chosen BEFORE first activation
  const [message, setMessage] = useState(null);
  const [switching, setSwitching] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");

  function refresh() {
    getBillingStatus().then(setStatus);
  }

  useEffect(refresh, []);

  useEffect(() => {
    if (!status) return;
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
    if (pending.purpose !== "subscription_activation" || String(pending.organizationId) !== String(status.id)) return;
    activateSubscription(paymentId, pending.requestReference, pending.interval)
      .then((result) => {
        if (!result.error) {
          setMessage({ type: "success", text: result.message });
          sessionStorage.removeItem("rakaez_pending_payment");
          window.history.replaceState({}, "", window.location.pathname);
          refresh();
        } else {
          setMessage({
            type: "error",
            text: `${t("error_prefix")}: ${result.error}. احتفظ بمرجع الدفع وتواصل مع الدعم إذا تم الخصم.`,
          });
        }
      })
      .catch(() => setMessage({ type: "error", text: "تعذر الاتصال بالخادم للتحقق من الدفعة. احتفظ بمرجع الدفع وأعد المحاولة." }));
  }, [status?.id, t]);

  async function onCardSaved(payment) {
    setShowForm(false);
    if (payment.status === "initiated") return;
    if (payment.status !== "paid" && payment.status !== "captured") {
      setMessage({ type: "error", text: t("payment_incomplete") + ": " + payment.status });
      return;
    }
    if (!payment.source?.token) {
      setMessage({ type: "error", text: "تعذّر حفظ بيانات البطاقة للتجديد التلقائي — حاول مرة أخرى." });
      return;
    }
    let result;
    try {
      result = await activateSubscription(payment.id, paymentReference, interval);
    } catch {
      setMessage({ type: "error", text: "تعذر الاتصال بالخادم للتحقق من الدفعة. احتفظ بمرجع الدفع وأعد المحاولة." });
      return;
    }
    if (result.error) {
      setMessage({ type: "error", text: `${t("error_prefix")}: ${result.error}` });
      return;
    }
    sessionStorage.removeItem("rakaez_pending_payment");
    setMessage({ type: "success", text: result.message });
    refresh();
  }

  function beginActivation() {
    const requestReference = crypto.randomUUID();
    setPaymentReference(requestReference);
    sessionStorage.setItem("rakaez_pending_payment", JSON.stringify({
      purpose: "subscription_activation",
      requestReference,
      interval,
      organizationId: status.id,
    }));
    setShowForm(true);
  }

  async function onSwitchInterval(newInterval) {
    setSwitching(true);
    try {
      const result = await changeBillingInterval(newInterval);
      if (result.error) {
        setMessage({ type: "error", text: `${t("error_prefix")}: ${result.error}` });
        return;
      }
      setMessage({ type: "success", text: `${result.message} ${t("interval_change_hint")}` });
      refresh();
    } finally {
      setSwitching(false);
    }
  }

  if (!status) return <p>{t("loading")}</p>;

  const daysLeft = status.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(status.trial_ends_at) - new Date()) / 86400000))
    : null;

  const chosenAmount = interval === "yearly" ? Number(status.plan_price_yearly_sar) : Number(status.plan_price_sar);

  return (
    <div style={{ maxWidth: 480 }}>
      <h3>{t("billing_title")}</h3>

      <div className="rk-card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>{t("plan_label")}</span>
          <b>{status.plan}</b>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>{t("monthly_price")}</span>
          <b>
            {Number(status.plan_price_sar).toFixed(2)} {t("sar")}
          </b>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>{t("yearly_price")}</span>
          <b>
            {Number(status.plan_price_yearly_sar).toFixed(2)} {t("sar")}
          </b>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>{t("status_label")}</span>
          <b>
            {status.subscription_status === "trialing" && `${t("status_trialing")} — ${daysLeft} ${t("days_left")}`}
            {status.subscription_status === "active" && t("status_active")}
            {status.subscription_status === "past_due" && t("status_past_due")}
            {status.subscription_status === "canceled" && t("status_canceled")}
          </b>
        </div>
        {status.subscription_status === "active" && (
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>{t("billing_cycle_label")}</span>
            <b>{status.billing_interval === "yearly" ? t("yearly") : t("monthly")}</b>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{t("payment_method_label")}</span>
          <b>{status.has_payment_method ? t("card_saved") : t("none")}</b>
        </div>
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

      {!paymentsEnabled && (
        <div style={{ padding: 12, borderRadius: 8, background: "#fffbeb", border: "1px solid #fcd34d" }}>
          الدفع الإلكتروني غير مفعّل في النسخة التجريبية. لن يتم خصم أي مبلغ.
        </div>
      )}
      {paymentsEnabled && !status.has_payment_method && !showForm && (
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t("choose_cycle")}</p>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => setInterval("monthly")}
              style={{
                flex: 1,
                padding: 10,
                border: interval === "monthly" ? "2px solid var(--rakaez-gold)" : "1px solid var(--rakaez-border)",
                background: interval === "monthly" ? "var(--rakaez-bg-soft)" : "var(--rakaez-surface)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("monthly")}
              <div style={{ fontSize: 11, color: "#6b5a3f" }}>
                {Number(status.plan_price_sar).toFixed(0)} {t("sar")}
              </div>
            </button>
            <button
              onClick={() => setInterval("yearly")}
              style={{
                flex: 1,
                padding: 10,
                border: interval === "yearly" ? "2px solid var(--rakaez-gold)" : "1px solid var(--rakaez-border)",
                background: interval === "yearly" ? "var(--rakaez-bg-soft)" : "var(--rakaez-surface)",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {t("yearly")}
              <div style={{ fontSize: 11, color: "#6b5a3f" }}>
                {Number(status.plan_price_yearly_sar).toFixed(0)} {t("sar")}
              </div>
            </button>
          </div>
          <button className="rk-btn" style={{ width: "100%" }} onClick={beginActivation}>
            {t("add_card_activate")}
          </button>
        </div>
      )}

      {paymentsEnabled && showForm && (
        <div>
          <p style={{ fontSize: 12, color: "#777" }}>
            {t(interval === "yearly" ? "yearly_charge_notice" : "monthly_charge_notice", { amount: chosenAmount.toFixed(2) })}
          </p>
          <MoyasarCheckout
            amountSar={chosenAmount}
            description={`تفعيل اشتراك ركائز - ${status.name} - ${interval === "yearly" ? "سنوي" : "شهري"}`}
            saveCard={true}
            paymentMetadata={{
              rakaez_purpose: "subscription_activation",
              rakaez_request_reference: paymentReference,
              rakaez_organization_id: String(status.id),
            }}
            onCompleted={onCardSaved}
            onCancel={() => {
              setShowForm(false);
              setPaymentReference("");
              sessionStorage.removeItem("rakaez_pending_payment");
            }}
          />
        </div>
      )}

      {status.has_payment_method && status.subscription_status === "active" && (
        <>
          <p style={{ fontSize: 12, color: "#777" }}>
            {t(status.billing_interval === "yearly" ? "card_saved_notice_yearly" : "card_saved_notice_monthly")}
          </p>
          <button
            className="rk-btn-outline"
            disabled={switching}
            onClick={() => onSwitchInterval(status.billing_interval === "yearly" ? "monthly" : "yearly")}
          >
            {t(status.billing_interval === "yearly" ? "switch_to_monthly" : "switch_to_yearly")}
          </button>
        </>
      )}
    </div>
  );
}
