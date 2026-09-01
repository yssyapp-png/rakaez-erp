const MOYASAR_FORM_VERSION = "2.2.10";
const MOYASAR_CDN = `https://cdn.jsdelivr.net/npm/moyasar-payment-form@${MOYASAR_FORM_VERSION}/dist`;
const SCRIPT_INTEGRITY = String(import.meta.env.VITE_MOYASAR_SCRIPT_INTEGRITY || "");
const STYLE_INTEGRITY = String(import.meta.env.VITE_MOYASAR_STYLE_INTEGRITY || "");
let loadingPromise;

function hasValidIntegrity(value) {
  return /^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/**
 * Loads Moyasar's official, pinned web form only when a payment screen is
 * opened. This keeps a third-party script out of every non-payment page and
 * gives the UI a deterministic error instead of leaving a blank form.
 */
export function loadMoyasarForm() {
  if (window.Moyasar) return Promise.resolve(window.Moyasar);
  if (loadingPromise) return loadingPromise;
  if (!hasValidIntegrity(SCRIPT_INTEGRITY) || !hasValidIntegrity(STYLE_INTEGRITY)) {
    return Promise.reject(new Error("moyasar_integrity_required"));
  }

  loadingPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[data-rakaez-moyasar="${MOYASAR_FORM_VERSION}"]`)) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = `${MOYASAR_CDN}/moyasar.css`;
      stylesheet.integrity = STYLE_INTEGRITY;
      stylesheet.crossOrigin = "anonymous";
      stylesheet.dataset.rakaezMoyasar = MOYASAR_FORM_VERSION;
      document.head.appendChild(stylesheet);
    }

    const script = document.createElement("script");
    script.src = `${MOYASAR_CDN}/moyasar.umd.min.js`;
    script.async = true;
    script.integrity = SCRIPT_INTEGRITY;
    script.crossOrigin = "anonymous";
    script.dataset.rakaezMoyasar = MOYASAR_FORM_VERSION;

    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("moyasar_load_timeout"));
    }, 15000);

    script.addEventListener("load", () => {
      window.clearTimeout(timeout);
      if (window.Moyasar) resolve(window.Moyasar);
      else reject(new Error("moyasar_global_missing"));
    }, { once: true });
    script.addEventListener("error", () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("moyasar_load_failed"));
    }, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    loadingPromise = undefined;
    throw error;
  });

  return loadingPromise;
}

export { MOYASAR_FORM_VERSION };
