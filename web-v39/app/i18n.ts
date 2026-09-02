export const locales = ["ar", "en"] as const;
export type Locale = (typeof locales)[number];

type TranslationShape = {
  brand: string;
  descriptor: string;
  suite: string;
  command: string;
  branch: string;
  search: string;
  nav: readonly string[];
  intro: string;
  live: string;
  protected: string;
  cards: readonly [string, string, string, string];
  inventoryTitle: string;
  inventoryText: string;
  stockTitle: string;
  workshopTitle: string;
  workshopText: string;
  all: string;
  low: string;
  out: string;
  available: string;
  reserved: string;
  shelf: string;
  qty: string;
  eta: string;
  quote: string;
  safe: string;
  theme: string;
  auto: string;
  light: string;
  dark: string;
  updated: string;
  refreshing: string;
  unavailable: string;
  closeMenu: string;
  openMenu: string;
  mainNavigation: string;
  switchLanguage: string;
  notifications: string;
  performance: string;
  emptySearch: string;
  translationPending: string;
  catalog: string;
  active: string;
  profileInitial: string;
  vehicle: {
    title: string;
    hint: string;
    make: string;
    model: string;
    year: string;
    engine: string;
    choose: string;
    action: string;
    clear: string;
    vin: string;
    vinPlaceholder: string;
    vinAction: string;
    vinInvalid: string;
    vinMissing: string;
    vinError: string;
    vinFound: string;
    suggestions: string;
  };
  operations: readonly [string, string, string, string, string, string];
};

export const translations = {
  ar: {
    brand: "ركائز",
    descriptor: "إدارة قطع غيار السيارات",
    suite: "منصة التشغيل الذكية",
    command: "مركز قيادة الأعمال",
    branch: "المركز الرئيسي - جدة",
    search: "ابحث برقم OEM أو رقم القطعة أو اسمها أو VIN…",
    nav: ["نظرة عامة", "المخزون", "شبكة الورش", "الفواتير", "الصندوق والتدقيق"],
    intro: "كل ما يحتاجه متجرك - من الرف إلى الورشة - في مساحة تشغيل واحدة.",
    live: "النظام يعمل بصورة طبيعية",
    protected: "تشغيل آمن ومراقب",
    cards: ["إجمالي القطع", "المخزون المتاح", "تنبيهات المخزون", "طلبات الورش"],
    inventoryTitle: "حركة المخزون المباشرة",
    inventoryText: "بيانات فعلية من قاعدة المخزون",
    stockTitle: "حالة القطع",
    workshopTitle: "طلبات الورش الجديدة",
    workshopText: "عروض تحتاج ردًا سريعًا",
    all: "عرض جميع القطع",
    low: "مخزون منخفض",
    out: "نافد",
    available: "متوفر",
    reserved: "محجوز",
    shelf: "الرف",
    qty: "الكمية",
    eta: "وقت الرد المتبقي",
    quote: "إرسال عرض",
    safe: "بيانات كل متجر معزولة ومحمية",
    theme: "نمط العرض",
    auto: "تلقائي",
    light: "نهاري",
    dark: "ليلي",
    updated: "آخر تحديث",
    refreshing: "جارٍ تحديث البيانات",
    unavailable: "تعذر تحديث البيانات؛ ستتم المحاولة تلقائيًا",
    closeMenu: "إغلاق القائمة",
    openMenu: "فتح القائمة",
    mainNavigation: "التنقل الرئيسي",
    switchLanguage: "التبديل إلى الإنجليزية",
    notifications: "التنبيهات",
    performance: "مؤشرات الأداء",
    emptySearch: "لا توجد قطعة مطابقة للبحث",
    translationPending: "اسم بديل - الترجمة قيد المراجعة",
    catalog: "من الكتالوج",
    active: "نشطة",
    profileInitial: "ر",
    vehicle: {
      title: "ابحث حسب السيارة",
      hint: "ابحث برقم الهيكل أو حدّد الشركة المصنعة والموديل وسنة الموديل والمحرك",
      make: "الشركة المصنعة",
      model: "الموديل",
      year: "سنة الموديل",
      engine: "المحرك",
      choose: "اختر البيانات",
      action: "عرض القطع المتوافقة",
      clear: "مسح الاختيار",
      vin: "رقم الهيكل VIN",
      vinPlaceholder: "أدخل رقم الهيكل المكوّن من 17 خانة",
      vinAction: "بحث برقم الهيكل",
      vinInvalid: "رقم الهيكل يجب أن يتكون من 17 حرفًا أو رقمًا بالإنجليزية، دون I أو O أو Q.",
      vinMissing: "رقم الهيكل غير مسجل في قاعدة ركائز حاليًا.",
      vinError: "تعذر تنفيذ البحث الآن.",
      vinFound: "تم التعرف على المركبة",
      suggestions: "اقتراحات الشركات المصنعة",
    },
    operations: [
      "مطابقة الرف والقطعة",
      "مخزون موحد لحظيًا",
      "مشتريات واستلام آمن",
      "تحويلات موثقة بين الفروع",
      "عزل بيانات الفروع والمنشآت",
      "امتثال سعودي ومراقبة مستمرة",
    ],
  },
  en: {
    brand: "Rakaez",
    descriptor: "Automotive Parts Operations",
    suite: "Intelligent Operations Platform",
    command: "Business Command Center",
    branch: "Jeddah Headquarters",
    search: "Search by OEM, part number, name, or VIN…",
    nav: ["Overview", "Inventory", "Workshop Network", "Invoices", "Cash & Audit"],
    intro: "Everything your store needs - from shelf to workshop - in one operating space.",
    live: "All systems are operating normally",
    protected: "Secure, monitored operations",
    cards: ["Total parts", "Available stock", "Stock alerts", "Workshop requests"],
    inventoryTitle: "Live inventory movement",
    inventoryText: "Live data from the inventory database",
    stockTitle: "Parts status",
    workshopTitle: "New workshop requests",
    workshopText: "Quotes requiring a prompt response",
    all: "View all parts",
    low: "Low stock",
    out: "Out of stock",
    available: "Available",
    reserved: "Reserved",
    shelf: "Shelf",
    qty: "Quantity",
    eta: "Response time remaining",
    quote: "Send quote",
    safe: "Each store’s data is isolated and protected",
    theme: "Display mode",
    auto: "Automatic",
    light: "Day",
    dark: "Night",
    updated: "Last updated",
    refreshing: "Refreshing data",
    unavailable: "Data refresh failed; retrying automatically",
    closeMenu: "Close menu",
    openMenu: "Open menu",
    mainNavigation: "Main navigation",
    switchLanguage: "Switch to Arabic",
    notifications: "Notifications",
    performance: "Performance metrics",
    emptySearch: "No matching part found",
    translationPending: "Fallback name - translation under review",
    catalog: "From catalog",
    active: "Active",
    profileInitial: "R",
    vehicle: {
      title: "Search by vehicle",
      hint: "Search by VIN or select the make, model, model year, and engine",
      make: "Make",
      model: "Model",
      year: "Model Year",
      engine: "Engine",
      choose: "Select",
      action: "Show compatible parts",
      clear: "Clear selection",
      vin: "Vehicle VIN",
      vinPlaceholder: "Enter the 17-character VIN",
      vinAction: "Search by VIN",
      vinInvalid: "VIN must contain 17 English letters or digits, excluding I, O, and Q.",
      vinMissing: "This VIN is not currently registered in the Rakaez database.",
      vinError: "VIN search is currently unavailable.",
      vinFound: "Vehicle identified",
      suggestions: "Vehicle make suggestions",
    },
    operations: [
      "Shelf and part matching",
      "Unified live inventory",
      "Secure purchasing and receiving",
      "Audited transfers between branches",
      "Branch and tenant data isolation",
      "Saudi compliance and continuous monitoring",
    ],
  },
} as const satisfies Record<Locale, TranslationShape>;

export type AppTranslation = (typeof translations)[Locale];

export function resolveLocale(language?: string | null): Locale {
  return language?.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function flattenTranslation(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") {
    if (!value.trim()) throw new Error(`Empty translation at ${prefix}`);
    return [prefix];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => flattenTranslation(item, `${prefix}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => flattenTranslation(item, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

export function assertTranslationParity(): true {
  const arabicKeys = flattenTranslation(translations.ar).sort();
  const englishKeys = flattenTranslation(translations.en).sort();
  if (arabicKeys.length !== englishKeys.length || arabicKeys.some((key, index) => key !== englishKeys[index])) {
    throw new Error("Arabic and English translation keys are not identical");
  }
  return true;
}

assertTranslationParity();
