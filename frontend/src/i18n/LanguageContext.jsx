import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Minimal in-house i18n — no external library needed for two languages.
 * Translations live in dictionaries below, keyed by a short `key`. Add new
 * keys here as more views get translated; anything missing falls back to
 * the Arabic string itself so untranslated screens don't break, they just
 * stay in Arabic until someone adds the English line.
 */
const STRINGS = {
  ar: {
    appTitle: "🔧 ركائز لقطع غيار السيارات",
    login: "تسجيل الدخول / إنشاء حساب",
    logout: "تسجيل خروج",
    welcome: "مرحباً",
    tab_customer: "📱 تطبيق العميل",
    tab_seller: "🧰 البائع / نقاط البيع",
    tab_parts: "📦 قطع الغيار والمخزون",
    tab_warehouse: "🏭 المستودع",
    tab_admin: "📊 لوحة تحكم الإدارة",
    tab_billing: "💳 الاشتراك والفوترة",
    lang_toggle: "English",

    login_title: "تسجيل الدخول",
    join_title: "إنشاء حساب عميل",
    new_shop_title: "سجّل متجرك الجديد في ركائز",
    brandSuffix: "ركائز",
    trial_notice: "يبدأ متجرك بتجربة مجانية 30 يوماً تلقائياً — لا حاجة لبطاقة ائتمان الآن.",
    full_name: "الاسم الكامل",
    business_name: "اسم المتجر / المنشأة",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    submitting: "...",
    have_account: "لديك حساب؟ سجّل الدخول",
    new_customer: "عميل جديد؟ أنشئ حساباً في المتجر التجريبي",
    shop_owner: "صاحب متجر؟ سجّل متجرك الخاص (تجربة مجانية)",
    demo_accounts: "حساب بائع تجريبي: seller1@example.com / 123456 — حساب إدارة: admin@example.com / 123456",
    err_email_taken: "هذا البريد مستخدم مسبقاً",
    err_missing_business_name: "الرجاء إدخال اسم المتجر",
    err_generic: "بيانات الدخول غير صحيحة أو حدث خطأ",

    // CustomerView
    please_login: "يرجى تسجيل الدخول لتصفح المتجر وإتمام الطلب.",
    order_confirmed: "✅ تم تأكيد طلبك",
    invoice_number: "رقم الفاتورة",
    total_label: "الإجمالي",
    continue_shopping: "متابعة التسوق",
    search_by_name: "بحث بالاسم",
    search_by_pn: "رقم القطعة",
    search_by_vin: "رقم الهيكل (VIN)",
    search_placeholder: "ابحث عن قطعة...",
    search_btn: "بحث",
    add_to_cart: "أضف للسلة",
    cart: "السلة",
    total_incl_vat: "الإجمالي (شامل 15% ضريبة)",
    pay_online: "الدفع الإلكتروني",
    payment_incomplete: "لم تكتمل عملية الدفع",
    payment_registered_error: "تم الدفع لكن حدث خطأ أثناء تسجيل الطلب",
    contact_support: "يرجى التواصل مع الدعم لاسترجاع المبلغ",
    sar: "ر.س",

    // SellerView
    seller_search_placeholder: "ابحث عن قطعة، رقم قطعة، أو رقم الهيكل",
    col_part: "القطعة",
    col_price: "السعر",
    col_location: "الموقع",
    add_btn: "إضافة",
    invoice_title: "الفاتورة",
    checkout_btn: "إتمام البيع",
    invoice_issued: "تم إصدار الفاتورة رقم",
    error_prefix: "خطأ",

    // AdminView
    loading: "جارِ التحميل...",
    trial_ends_in: "فترتك التجريبية المجانية لمتجر",
    ends_within: "تنتهي خلال",
    days: "يوم",
    current_plan: "باقتك الحالية",
    payment_overdue: "يوجد تأخر في الدفع لاشتراك",
    update_payment_notice: "يرجى تحديث وسيلة الدفع لتفادي إيقاف الحساب",
    inventory_value: "قيمة المخزون",
    total_sales: "إجمالي المبيعات",
    low_stock_items: "أصناف تحت الحد الأدنى",
    inventory_by_branch: "المخزون حسب الفروع",
    col_branch: "الفرع",
    col_item_count: "عدد الأصناف",
    col_low_stock: "تحت الحد الأدنى",
    recent_invoices: "آخر الفواتير",
    col_payment: "الدفع",
    col_zatca_status: "حالة ZATCA",
    zatca_ready_note: "QR جاهز (غير مرفوع لـ ZATCA)",
    zatca_footnote:
      '* "QR جاهز" يعني أن رمز الاستجابة السريعة المطلوب على الفاتورة الضريبية المبسطة (المرحلة الأولى من ZATCA) تم توليده وتخزينه، لكن لم يتم بعد ربط النظام فعلياً ببوابة فاتورة (Fatoora) لإرسال الفواتير إلكترونياً (المرحلة الثانية).',

    // BillingView
    billing_title: "الاشتراك والفوترة",
    plan_label: "الباقة",
    monthly_price: "السعر الشهري",
    yearly_price: "السعر السنوي",
    status_label: "الحالة",
    status_trialing: "تجريبي",
    days_left: "يوم متبقٍ",
    status_active: "نشط ✅",
    status_past_due: "متأخر بالدفع ⚠️",
    status_canceled: "ملغي",
    payment_method_label: "وسيلة الدفع",
    card_saved: "بطاقة محفوظة ✅",
    none: "لا توجد",
    billing_cycle_label: "دورة الفوترة",
    monthly: "شهري",
    yearly: "سنوي (وفّر شهرين)",
    choose_cycle: "اختر دورة الفوترة",
    add_card_activate: "إضافة بطاقة وتفعيل الاشتراك",
    yearly_charge_notice: "سيتم خصم {amount} ر.س الآن كدفعة سنوية واحدة، وبعدها يتجدد الاشتراك تلقائياً كل سنة بدون أي إجراء منك.",
    monthly_charge_notice: "سيتم خصم {amount} ر.س الآن، وبعدها يتجدد الاشتراك تلقائياً كل شهر بدون أي إجراء منك — تماماً مثل أي اشتراك تطبيق جوال.",
    card_saved_notice_monthly: "بطاقتك محفوظة بأمان لدى Moyasar (لا نحتفظ نحن برقم البطاقة إطلاقاً) — سيتم التجديد تلقائياً كل شهر.",
    card_saved_notice_yearly: "بطاقتك محفوظة بأمان لدى Moyasar (لا نحتفظ نحن برقم البطاقة إطلاقاً) — سيتم التجديد تلقائياً كل سنة.",
    switch_to_yearly: "التبديل للفوترة السنوية",
    switch_to_monthly: "التبديل للفوترة الشهرية",
    interval_change_hint: "يُطبَّق التغيير عند التجديد القادم دون رسوم إضافية الآن.",

    // PartsManagementView
    parts_title: "إدارة قطع الغيار والمخزون",
    add_new_part: "+ إضافة قطعة جديدة",
    saved_success: "تم الحفظ بنجاح",
    col_part_number: "رقم القطعة",
    col_name: "الاسم",
    col_brand: "الماركة",
    col_stock_per_branch: "المخزون بكل فرع",
    edit: "تعديل",
    delete: "حذف",
    no_parts_yet: "لا توجد قطع غيار بعد — أضف أول قطعة من الزر أعلاه.",
    ph_part_number: "رقم القطعة (P-1001)",
    ph_name: "الاسم",
    ph_brand: "الماركة",
    ph_category: "الفئة",
    ph_price: "السعر",
    ph_cost: "التكلفة",
    ph_initial_qty: "الكمية الأولية",
    save: "حفظ",
    cancel: "إلغاء",
  },
  en: {
    appTitle: "🔧 Rakaez Auto Parts",
    login: "Sign in / Create account",
    logout: "Log out",
    welcome: "Welcome",
    tab_customer: "📱 Customer app",
    tab_seller: "🧰 Seller / POS",
    tab_parts: "📦 Parts & Inventory",
    tab_warehouse: "🏭 Warehouse",
    tab_admin: "📊 Admin dashboard",
    tab_billing: "💳 Subscription & Billing",
    lang_toggle: "العربية",

    login_title: "Sign in",
    join_title: "Create a customer account",
    new_shop_title: "Register your new shop on Rakaez",
    brandSuffix: "Rakaez",
    trial_notice: "Your shop starts with an automatic 30-day free trial — no credit card needed yet.",
    full_name: "Full name",
    business_name: "Shop / business name",
    email: "Email",
    password: "Password",
    submitting: "...",
    have_account: "Already have an account? Sign in",
    new_customer: "New customer? Create an account in the demo shop",
    shop_owner: "Shop owner? Register your own shop (free trial)",
    demo_accounts: "Demo seller: seller1@example.com / 123456 — Demo admin: admin@example.com / 123456",
    err_email_taken: "This email is already in use",
    err_missing_business_name: "Please enter a shop name",
    err_generic: "Invalid credentials or something went wrong",

    // CustomerView
    please_login: "Please sign in to browse the shop and check out.",
    order_confirmed: "✅ Your order is confirmed",
    invoice_number: "Invoice number",
    total_label: "Total",
    continue_shopping: "Continue shopping",
    search_by_name: "Search by name",
    search_by_pn: "Part number",
    search_by_vin: "VIN",
    search_placeholder: "Search for a part...",
    search_btn: "Search",
    add_to_cart: "Add to cart",
    cart: "Cart",
    total_incl_vat: "Total (incl. 15% VAT)",
    pay_online: "Pay online",
    payment_incomplete: "Payment was not completed",
    payment_registered_error: "Payment succeeded but the order failed to register",
    contact_support: "please contact support for a refund",
    sar: "SAR",

    // SellerView
    seller_search_placeholder: "Search by part, part number, or VIN",
    col_part: "Part",
    col_price: "Price",
    col_location: "Location",
    add_btn: "Add",
    invoice_title: "Invoice",
    checkout_btn: "Complete sale",
    invoice_issued: "Invoice issued, number",
    error_prefix: "Error",

    // AdminView
    loading: "Loading...",
    trial_ends_in: "Your free trial for",
    ends_within: "ends in",
    days: "days",
    current_plan: "Current plan",
    payment_overdue: "Payment is overdue for",
    update_payment_notice: "please update your payment method to avoid suspension",
    inventory_value: "Inventory value",
    total_sales: "Total sales",
    low_stock_items: "Low-stock items",
    inventory_by_branch: "Inventory by branch",
    col_branch: "Branch",
    col_item_count: "Item count",
    col_low_stock: "Low stock",
    recent_invoices: "Recent invoices",
    col_payment: "Payment",
    col_zatca_status: "ZATCA status",
    zatca_ready_note: "QR ready (not submitted to ZATCA)",
    zatca_footnote:
      '* "QR ready" means the QR code required on a simplified tax invoice (ZATCA Phase 1) has been generated and stored, but the system is not yet connected to the Fatoora portal for electronic submission (Phase 2).',

    // BillingView
    billing_title: "Subscription & Billing",
    plan_label: "Plan",
    monthly_price: "Monthly price",
    yearly_price: "Yearly price",
    status_label: "Status",
    status_trialing: "Trial",
    days_left: "days left",
    status_active: "Active ✅",
    status_past_due: "Past due ⚠️",
    status_canceled: "Canceled",
    payment_method_label: "Payment method",
    card_saved: "Card on file ✅",
    none: "None",
    billing_cycle_label: "Billing cycle",
    monthly: "Monthly",
    yearly: "Yearly (save 2 months)",
    choose_cycle: "Choose your billing cycle",
    add_card_activate: "Add card & activate subscription",
    yearly_charge_notice: "{amount} SAR will be charged now as a single yearly payment, and the subscription will renew automatically every year with no action from you.",
    monthly_charge_notice: "{amount} SAR will be charged now, and the subscription will renew automatically every month with no action from you — just like any app subscription.",
    card_saved_notice_monthly: "Your card is stored securely with Moyasar (we never see your card number) — it will renew automatically every month.",
    card_saved_notice_yearly: "Your card is stored securely with Moyasar (we never see your card number) — it will renew automatically every year.",
    switch_to_yearly: "Switch to yearly billing",
    switch_to_monthly: "Switch to monthly billing",
    interval_change_hint: "The change applies at your next renewal, no extra charge now.",

    // PartsManagementView
    parts_title: "Parts & Inventory Management",
    add_new_part: "+ Add new part",
    saved_success: "Saved successfully",
    col_part_number: "Part number",
    col_name: "Name",
    col_brand: "Brand",
    col_stock_per_branch: "Stock per branch",
    edit: "Edit",
    delete: "Delete",
    no_parts_yet: "No parts yet — add your first one with the button above.",
    ph_part_number: "Part number (P-1001)",
    ph_name: "Name",
    ph_brand: "Brand",
    ph_category: "Category",
    ph_price: "Price",
    ph_cost: "Cost",
    ph_initial_qty: "Initial quantity",
    save: "Save",
    cancel: "Cancel",
  },
};

const STORAGE_KEY = "rakaez_lang";
const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "ar";
    } catch {
      return "ar";
    }
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore (e.g. private browsing storage restrictions)
    }
  }, [lang]);

  function t(key, vars) {
    let str = STRINGS[lang][key] ?? STRINGS.ar[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replaceAll(`{${k}}`, v);
      }
    }
    return str;
  }

  function toggleLang() {
    setLang((l) => (l === "ar" ? "en" : "ar"));
  }

  return (
    <LanguageContext.Provider value={{ lang, t, toggleLang }}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
