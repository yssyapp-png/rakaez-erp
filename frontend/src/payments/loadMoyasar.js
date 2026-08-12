const MOYASAR_FORM_VERSION = "2.2.10";
const MOYASAR_CDN = `https://cdn.jsdelivr.net/npm/moyasar-payment-form@${MOYASAR_FORM_VERSION}/dist`;
let loadingPromise;

/**
 * Loads Moyasar's official, pinned web form only when a payment screen is
 * opened. This keeps a third-party script out of every non-payment page and
 * gives the UI a deterministic error instead of leaving a blank form.
 */
export function loadMoyasarForm() {
  if (window.Moyasar) return Promise.resolve(window.Moyasar);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[data-rakaez-moyasar="${MOYASAR_FORM_VERSION}"]`)) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = `${MOYASAR_CDN}/moyasar.css`;
      stylesheet.dataset.rakaezMoyasar = MOYASAR_FORM_VERSION;
      document.head.appendChild(stylesheet);
    }

    const script = document.createElement("script");
    script.src = `${MOYASAR_CDN}/moyasar.umd.min.js`;
    script.async = true;
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
