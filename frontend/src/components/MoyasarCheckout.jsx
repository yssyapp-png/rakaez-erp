import React, { useEffect, useRef, useState } from "react";
import { loadMoyasarForm } from "../payments/loadMoyasar.js";

/**
 * Mounts Moyasar's hosted payment form inside `#moyasar-form`. Moyasar
 * collects the card number/CVV itself (inside its own iframe) so raw card
 * data never passes through our React state or our backend. The caller sends
 * only the resulting payment id for independent server-side verification.
 *
 * Docs: https://docs.moyasar.com/payment-form
 */
export default function MoyasarCheckout({ amountSar, description, onCompleted, onCancel, saveCard = false, paymentMetadata = {} }) {
  const initialConfiguration = useRef({ amountSar, description, onCompleted, saveCard, paymentMetadata });
  const initiating = useRef(false);
  const [configurationError, setConfigurationError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const configuration = initialConfiguration.current;

    const publishableKey = import.meta.env.VITE_MOYASAR_PUBLISHABLE_KEY;
    if (!publishableKey || !/^pk_(test|live)_[A-Za-z0-9]+$/.test(publishableKey)) {
      console.error("Moyasar is not configured with a valid publishable key");
      setConfigurationError("تعذّر تحميل بوابة الدفع. لم يتم خصم أي مبلغ؛ أعد المحاولة أو تواصل مع الدعم.");
      return undefined;
    }

    loadMoyasarForm()
      .then((Moyasar) => {
        if (cancelled) return;
        Moyasar.init({
          element: "#moyasar-form",
          amount: Math.round(configuration.amountSar * 100), // halalas
          currency: "SAR",
          description: configuration.description,
          publishable_api_key: publishableKey,
          callback_url: `${window.location.origin}${window.location.pathname}`,
          supported_networks: ["mada", "visa", "mastercard"],
          methods: ["creditcard"],
          on_initiating: async () => {
            if (initiating.current) return false;
            initiating.current = true;
            return {
              amount: Math.round(configuration.amountSar * 100),
              description: configuration.description,
              callback_url: `${window.location.origin}${window.location.pathname}`,
              metadata: configuration.paymentMetadata,
            };
          },
          // saveCard:true (subscription flow) asks Moyasar to attach a reusable
          // token to the payment; the backend accepts it only after fetching and
          // verifying the final payment after 3DS.
          ...(configuration.saveCard ? { credit_card: { save_card: true } } : {}),
          on_completed: (payment) => configuration.onCompleted(payment),
          on_failure: (error) => {
            initiating.current = false;
            console.error("Moyasar payment form failed:", error);
            setConfigurationError("تعذّر بدء عملية الدفع. لم يتم خصم أي مبلغ؛ تحقق من البيانات وحاول مرة أخرى.");
          },
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Moyasar payment form could not be loaded:", error);
        setConfigurationError("تعذّر تحميل بوابة الدفع. لم يتم خصم أي مبلغ؛ تحقق من الاتصال ثم أعد المحاولة.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      {configurationError && (
        <div style={{ padding: 10, marginBottom: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8 }}>
          {configurationError}
        </div>
      )}
      <div id="moyasar-form" aria-live="polite"></div>
      <button style={{ marginTop: 10 }} onClick={onCancel}>
        إلغاء
      </button>
    </div>
  );
}
