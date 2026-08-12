import React, { useEffect, useRef, useState } from "react";

/**
 * Mounts Moyasar's hosted payment form inside `#moyasar-form`. Moyasar
 * collects the card number/CVV itself (inside its own iframe) so raw card
 * data never passes through our React state or our backend. The caller sends
 * only the resulting payment id for independent server-side verification.
 *
 * Docs: https://docs.moyasar.com/payment-form
 */
export default function MoyasarCheckout({ amountSar, description, onCompleted, onCancel, saveCard = false, paymentMetadata = {} }) {
  const mounted = useRef(false);
  const [configurationError, setConfigurationError] = useState("");

  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const publishableKey = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY;
    if (!publishableKey || !window.Moyasar) {
      console.error("Moyasar is not configured (missing VITE_MOYASAR_PUBLISHABLE_KEY or script not loaded)");
      setConfigurationError("تعذّر تحميل بوابة الدفع. لم يتم خصم أي مبلغ؛ أعد المحاولة أو تواصل مع الدعم.");
      return;
    }

    window.Moyasar.init({
      element: "#moyasar-form",
      amount: Math.round(amountSar * 100), // halalas
      currency: "SAR",
      description,
      publishable_api_key: publishableKey,
      callback_url: `${window.location.origin}${window.location.pathname}`,
      methods: ["creditcard"],
      on_initiating: async () => ({ metadata: paymentMetadata }),
      // saveCard:true (subscription flow) asks Moyasar to attach a reusable
      // token to the payment; the backend accepts it only after fetching and
      // verifying the final payment after 3DS.
      ...(saveCard ? { credit_card: { save_card: true } } : {}),
      on_completed: (payment) => {
        // payment.source.token / payment.id are available depending on SDK version;
        // we forward the raw payment object and let the caller decide what to send.
        onCompleted(payment);
      },
      on_failure: (error) => {
        console.error("Moyasar payment form failed:", error);
        setConfigurationError("تعذّر بدء عملية الدفع. لم يتم خصم أي مبلغ؛ تحقق من البيانات وحاول مرة أخرى.");
      },
    });
  }, [amountSar, description, onCompleted, paymentMetadata, saveCard]);

  return (
    <div>
      {configurationError && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>
          {configurationError}
        </div>
      )}
      <div id="moyasar-form"></div>
      <button style={{ marginTop: 10 }} onClick={onCancel}>
        إلغاء
      </button>
    </div>
  );
}
