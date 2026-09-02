"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AlertTriangle, ArrowLeftRight, Banknote, Bell, Boxes, Building2, CarFront, CheckCircle2, ChevronLeft, ClipboardCheck, Clock3, FileText, Gauge, Globe2, Menu, Moon, PackageCheck, RefreshCw, Search, ShieldCheck, ShoppingCart, Store, Sun, Truck, Warehouse, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveLocale, translations, type Locale } from "@/app/i18n";
import { InvoiceView } from "@/app/invoice-view";
import { CashControlView } from "@/app/cash-control-view";

type View = "overview" | "inventory" | "workshops" | "invoices" | "cash";
type Theme = "light" | "dark";
type ThemeMode = "auto" | Theme;

type DashboardData = {
  updatedAt: string;
  stats: { totalParts: number; onHand: number; reserved: number; lowStock: number; workshopRequests: number };
  inventory: Array<{ id: string; number: string; name: string; quantity: number; reserved: number; reorderPoint: number; shelf: string; status: "available" | "low" | "out"; translationLocale: string; translationFallback: boolean }>;
};


const vehicleOptions: Record<string, readonly string[]> = {
  Toyota: ["Camry", "Corolla", "Yaris", "Land Cruiser", "Land Cruiser Prado", "Hilux", "RAV4", "Fortuner", "Raize", "Highlander"],
  Lexus: ["ES", "IS", "LS", "UX", "NX", "RX", "GX", "LX"], Nissan: ["Patrol", "Altima", "Sunny", "X-Trail", "Kicks", "Pathfinder", "Navara", "Urvan"], Infiniti: ["Q50", "QX50", "QX55", "QX60", "QX80"],
  Hyundai: ["Accent", "Elantra", "Sonata", "Azera", "Creta", "Tucson", "Santa Fe", "Palisade", "Staria"], Genesis: ["G70", "G80", "G90", "GV60", "GV70", "GV80"], Kia: ["Pegas", "K3", "K5", "K8", "Sonet", "Seltos", "Sportage", "Sorento", "Carnival", "Telluride"],
  Mazda: ["Mazda 3", "Mazda 6", "CX-3", "CX-30", "CX-5", "CX-60", "CX-9", "CX-90"], Honda: ["City", "Civic", "Accord", "HR-V", "CR-V", "Pilot", "Odyssey"], Mitsubishi: ["Attrage", "ASX", "Eclipse Cross", "Outlander", "Montero Sport", "L200"], Suzuki: ["Dzire", "Swift", "Ciaz", "Jimny", "Fronx", "Grand Vitara"], Isuzu: ["D-Max", "MU-X"], Subaru: ["Impreza", "Legacy", "Crosstrek", "Forester", "Outback", "WRX"],
  Ford: ["Taurus", "Territory", "Explorer", "Everest", "Expedition", "Bronco", "Ranger", "F-150"], Lincoln: ["Corsair", "Nautilus", "Aviator", "Navigator"], Chevrolet: ["Groove", "Captiva", "Traverse", "Tahoe", "Suburban", "Silverado"], GMC: ["Terrain", "Acadia", "Yukon", "Sierra"], Cadillac: ["CT4", "CT5", "XT4", "XT5", "XT6", "Escalade"], Jeep: ["Renegade", "Compass", "Wrangler", "Grand Cherokee", "Gladiator"], Dodge: ["Charger", "Challenger", "Durango"], Ram: ["1500", "2500"], Tesla: ["Model 3", "Model Y", "Model S", "Model X"],
  "Mercedes-Benz": ["A-Class", "C-Class", "E-Class", "S-Class", "GLA", "GLC", "GLE", "GLS", "G-Class"], BMW: ["1 Series", "2 Series", "3 Series", "5 Series", "7 Series", "X1", "X3", "X5", "X6", "X7"], Mini: ["Cooper", "Countryman", "Aceman"], Audi: ["A3", "A4", "A6", "A8", "Q3", "Q5", "Q7", "Q8"], Volkswagen: ["Jetta", "Passat", "T-Roc", "Tiguan", "Teramont", "Golf"], Porsche: ["718", "911", "Macan", "Cayenne", "Panamera", "Taycan"], Volvo: ["S60", "S90", "XC40", "XC60", "XC90"], "Land-Rover": ["Defender", "Discovery", "Range Rover Evoque", "Range Rover Velar", "Range Rover Sport", "Range Rover"], Jaguar: ["XE", "XF", "F-Pace", "E-Pace", "F-Type"],
  Renault: ["Duster", "Koleos", "Megane", "Express"], Peugeot: ["208", "301", "408", "2008", "3008", "5008", "Partner"], Citroen: ["C3", "C4", "C5 Aircross"], Opel: ["Corsa", "Mokka", "Grandland"], Fiat: ["500", "500X", "Tipo", "Doblo"], "Alfa Romeo": ["Giulia", "Stelvio", "Tonale"], Skoda: ["Octavia", "Superb", "Karoq", "Kodiaq"], Cupra: ["Leon", "Formentor", "Ateca"],
  MG: ["MG 3", "MG 5", "MG 7", "ZS", "HS", "RX5", "RX8"], Geely: ["Emgrand", "Coolray", "Starray", "Monjaro", "Okavango"], Changan: ["Alsvin", "Eado Plus", "CS35 Plus", "CS55 Plus", "CS75 Plus", "UNI-T", "UNI-K"], GAC: ["Empow", "GA4", "GS3 Emzoom", "GS4", "GS8", "M8"], Chery: ["Arrizo 5", "Arrizo 8", "Tiggo 4", "Tiggo 7", "Tiggo 8"], Exeed: ["LX", "TXL", "RX", "VX"], Jetour: ["X50", "X70", "X90", "Dashing", "T1", "T2"], Haval: ["Jolion", "H6", "H9", "Dargo"], GWM: ["Wingle 5", "Wingle 7", "Poer"], Tank: ["Tank 300", "Tank 500"], BYD: ["Qin Plus", "Song Plus", "Atto 3", "Seal", "Han"], Hongqi: ["H5", "H9", "HS3", "HS5", "E-HS9"], BAIC: ["U5 Plus", "X35", "X55", "BJ40", "BJ60", "BJ80"], JAC: ["J7", "JS3", "JS4", "JS6", "T8"], Dongfeng: ["Shine", "Mage", "Huge", "Rich"], Bestune: ["B70", "T77", "T90", "B70S"], Maxus: ["D60", "D90", "T60", "T90", "V80"], Omoda: ["C5", "C7"], Jaecoo: ["J7", "J8"], KGM: ["Tivoli", "Korando", "Torres", "Rexton", "Musso"],
  Bentley: ["Bentayga", "Continental GT", "Flying Spur"], Lamborghini: ["Urus", "Huracan", "Revuelto"], Ferrari: ["Roma", "296", "SF90", "Purosangue"], Maserati: ["Ghibli", "Grecale", "Levante", "MC20"], "Rolls-Royce": ["Ghost", "Phantom", "Cullinan", "Spectre"], "Aston Martin": ["Vantage", "DB12", "DBX"], McLaren: ["Artura", "750S", "GT"], Polestar: ["Polestar 2", "Polestar 3", "Polestar 4"],
};

const vehicleBrandArabic: Record<string, string> = {
  Toyota:"تويوتا", Lexus:"لكزس", Nissan:"نيسان", Infiniti:"إنفينيتي", Hyundai:"هيونداي", Genesis:"جينيسيس", Kia:"كيا", Mazda:"مازدا", Honda:"هوندا", Mitsubishi:"ميتسوبيشي", Suzuki:"سوزوكي", Isuzu:"إيسوزو", Subaru:"سوبارو", Ford:"فورد", Lincoln:"لينكون", Chevrolet:"شفروليه", GMC:"جي إم سي", Cadillac:"كاديلاك", Jeep:"جيب", Dodge:"دودج", Ram:"رام", Tesla:"تسلا", "Mercedes-Benz":"مرسيدس بنز", BMW:"بي إم دبليو", Mini:"ميني", Audi:"أودي", Volkswagen:"فولكس واجن", Porsche:"بورش", Volvo:"فولفو", "Land-Rover":"لاند روفر", Jaguar:"جاكوار", Renault:"رينو", Peugeot:"بيجو", Citroen:"ستروين", Opel:"أوبل", Fiat:"فيات", "Alfa Romeo":"ألفا روميو", Skoda:"سكودا", Cupra:"كوبرا", MG:"إم جي", Geely:"جيلي", Changan:"شانجان", GAC:"جي أي سي", Chery:"شيري", Exeed:"إكسيد", Jetour:"جيتور", Haval:"هافال", GWM:"جريت وول", Tank:"تانك", BYD:"بي واي دي", Hongqi:"هونشي", BAIC:"بايك", JAC:"جاك", Dongfeng:"دونغ فينغ", Bestune:"بستون", Maxus:"ماكسوس", Omoda:"أومودا", Jaecoo:"جايكو", KGM:"كي جي إم", Bentley:"بنتلي", Lamborghini:"لامبورغيني", Ferrari:"فيراري", Maserati:"مازيراتي", "Rolls-Royce":"رولز رويس", "Aston Martin":"أستون مارتن", McLaren:"ماكلارين", Polestar:"بولستار",
};

const vehicleModelYears = Array.from({ length: 37 }, (_, index) => String(2026 - index));
const vehicleEngines = ["Electric", "Hybrid", "1.0L", "1.2L", "1.3L", "1.4L", "1.5L", "1.6L", "1.8L", "2.0L", "2.4L", "2.5L", "2.7L", "3.0L", "3.3L", "3.5L", "3.6L", "V6 4.0L", "V8 4.6L", "V8 5.0L", "V8 5.3L", "V8 5.7L", "V8 6.2L"] as const;

const normalizeIdentifierInput = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .toUpperCase();

const parts = [
  { number: "04465-33480", ar: "فحمات فرامل أمامية", en: "Front Brake Pads", qty: 3, reserved: 1, shelf: "A-12", status: "low", vehicles: ["Toyota:Camry", "Toyota:Corolla"] },
  { number: "90915-YZZD2", ar: "فلتر زيت محرك", en: "Engine Oil Filter", qty: 28, reserved: 4, shelf: "B-04", status: "available", vehicles: ["Toyota:Camry", "Nissan:Altima"] },
  { number: "17801-0H050", ar: "فلتر هواء", en: "Air Filter", qty: 0, reserved: 0, shelf: "C-18", status: "out", vehicles: ["Hyundai:Sonata", "Hyundai:Elantra"] },
] as const;

const workshops = [
  { name: { ar: "ورشة المسار المتقدم", en: "Advanced Track Workshop" }, vehicle: { ar: "تويوتا كامري 2022", en: "Toyota Camry 2022" }, part: "04465-33480", time: "08:42" },
  { name: { ar: "مركز المحرك الدقيق", en: "Precision Engine Center" }, vehicle: { ar: "هيونداي سوناتا 2021", en: "Hyundai Sonata 2021" }, part: "26300-35505", time: "12:15" },
] as const;

export function RakaezApp() {
  const [locale, setLocale] = useState<Locale>("ar");
  const [view, setView] = useState<View>("overview");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleMakeQuery, setVehicleMakeQuery] = useState("");
  const [makeSuggestionsOpen, setMakeSuggestionsOpen] = useState(false);
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleEngine, setVehicleEngine] = useState("");
  const [vinQuery, setVinQuery] = useState("");
  const [vehicleApplied, setVehicleApplied] = useState(false);
  const [vinStatus, setVinStatus] = useState<"idle" | "loading" | "invalid" | "missing" | "error" | "found">("idle");
  const [now, setNow] = useState(() => new Date());
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState(false);
  const t = translations[locale];
  const rtl = locale === "ar";
  const filteredParts = useMemo(() => {
    const liveParts = dashboard?.inventory ?? [];
    const normalized = normalizeIdentifierInput(query).trim().toLowerCase();
    const source = dashboard ? liveParts : parts.map((part) => ({ ...part, id: part.number, name: locale === "ar" ? part.ar : part.en, quantity: part.qty, reorderPoint: part.status === "low" ? part.qty : 0 }));
    return source.filter((part) => {
      const matchesText = !normalized || `${part.number} ${"name" in part ? part.name : ""}`.toLowerCase().includes(normalized);
      const matchesVehicle = !vehicleApplied || !("vehicles" in part) || (part.vehicles as readonly string[]).includes(`${vehicleMake}:${vehicleModel}`);
      return matchesText && matchesVehicle;
    });
  }, [query, vehicleApplied, vehicleMake, vehicleModel, dashboard, locale]);
  const matchingVehicleMakes = useMemo(() => {
    const search = vehicleMakeQuery.trim().toLocaleLowerCase(locale === "ar" ? "ar" : "en");
    return Object.keys(vehicleOptions).filter((make) => !search
      || make.toLowerCase().startsWith(search)
      || (vehicleBrandArabic[make] || "").startsWith(search)).slice(0, 12);
  }, [vehicleMakeQuery, locale]);
  const navIcons = [Gauge, Boxes, Wrench, FileText, Banknote];

  useEffect(() => {
    const savedLocale = window.localStorage.getItem("rakaez-locale");
    const automaticLocale = resolveLocale(navigator.language);
    const selected = savedLocale === "ar" || savedLocale === "en" ? savedLocale : automaticLocale;
    const timer = window.setTimeout(() => setLocale(selected), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
    window.localStorage.setItem("rakaez-locale", locale);
  }, [locale]);

  useEffect(() => {
    const saved = window.localStorage.getItem("rakaez-theme-mode") as ThemeMode | null;
    const timer = window.setTimeout(() => {
      setThemeMode(saved === "light" || saved === "dark" ? saved : "auto");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      if (themeMode !== "auto") return setTheme(themeMode);
      const hour = new Date().getHours();
      setTheme(hour >= 18 || hour < 6 ? "dark" : "light");
    };
    applyTheme();
    if (themeMode !== "auto") return;
    const timer = window.setInterval(applyTheme, 60_000);
    return () => window.clearInterval(timer);
  }, [themeMode]);

  useEffect(() => {
    const refreshClock = () => setNow(new Date());
    refreshClock();
    const timer = window.setInterval(refreshClock, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/dashboard?locale=${locale}`, { cache: "no-store" });
        if (!response.ok) throw new Error("dashboard_unavailable");
        const data = await response.json() as DashboardData;
        if (active) { setDashboard(data); setDashboardError(false); }
      } catch {
        if (active) setDashboardError(true);
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [locale]);

  const calendar = useMemo(() => ({
    weekday: new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", { weekday: "long", timeZone: "Asia/Riyadh" }).format(now),
    gregorian: new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB-u-ca-gregory", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(now),
    hijri: new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-islamic-umalqura" : "en-GB-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(now),
  }), [locale, now]);

  const stats = dashboard?.stats ?? { totalParts: parts.length, onHand: parts.reduce((sum, part) => sum + part.qty, 0), reserved: parts.reduce((sum, part) => sum + part.reserved, 0), lowStock: parts.filter((part) => part.status !== "available").length, workshopRequests: workshops.length };

  const selectThemeMode = (value: ThemeMode) => {
    setThemeMode(value);
    window.localStorage.setItem("rakaez-theme-mode", value);
  };

  const resetVehicle = () => {
    setVehicleMake(""); setVehicleMakeQuery(""); setVehicleModel(""); setVehicleYear(""); setVehicleEngine(""); setVehicleApplied(false);
  };

  const selectVehicleMake = (make: string) => {
    setVehicleMake(make); setVehicleMakeQuery(make); setVehicleModel(""); setVehicleYear(""); setVehicleEngine(""); setVehicleApplied(false); setMakeSuggestionsOpen(false);
  };

  const lookupVin = async (rawVin: string) => {
    const normalized = normalizeIdentifierInput(rawVin).trim();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(normalized)) return setVinStatus("invalid");
    setVinStatus("loading");
    try {
      const response = await fetch(`/api/vin?vin=${encodeURIComponent(normalized)}`, { cache: "no-store" });
      if (response.status === 404) return setVinStatus("missing");
      if (!response.ok) return setVinStatus("error");
      const data = await response.json() as { vehicle: { make: string; model: string; modelYear: string; engine: string } };
      setVehicleMake(data.vehicle.make); setVehicleMakeQuery(data.vehicle.make); setVehicleModel(data.vehicle.model); setVehicleYear(data.vehicle.modelYear); setVehicleEngine(data.vehicle.engine); setVehicleApplied(true); setVinStatus("found");
    } catch { setVinStatus("error"); }
  };

  const searchFromHeader = () => {
    const candidate = query.trim().toUpperCase();
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(candidate)) void lookupVin(candidate);
  };

  return (
    <main className="rakaez-shell" data-theme={theme} dir={rtl ? "rtl" : "ltr"} lang={locale}>
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><Image src="/rakaez-logo-gold.png" alt="" width={52} height={52} priority unoptimized /></div><div><strong>{t.brand}</strong><small>{t.descriptor}</small></div></div>
        <div className="suite-label"><span />{t.suite}</div>
        <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label={t.closeMenu}><X size={20} /></button>
        <div className="branch-chip"><Store size={17} /><span>{t.branch}</span><ChevronLeft size={15} /></div>
        <nav aria-label={t.mainNavigation}>
          {(["overview", "inventory", "workshops", "invoices", "cash"] as View[]).map((item, index) => { const Icon = navIcons[index]; return <button key={item} className={view === item ? "active" : ""} onClick={() => { setView(item); setMobileOpen(false); }}><Icon size={19} /><span>{t.nav[index]}</span></button>; })}
        </nav>
        <div className="sidebar-security"><ShieldCheck size={19} /><span>{t.safe}</span></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileOpen(true)} aria-label={t.openMenu}><Menu size={22} /></button>
          <div className="topbar-identity"><small>{t.suite}</small><strong>{t.command}</strong></div>
          <label className="global-search"><Search size={19} aria-hidden="true" /><Input dir={query ? "ltr" : rtl ? "rtl" : "ltr"} value={query} onChange={(e) => { setQuery(normalizeIdentifierInput(e.target.value)); setVinStatus("idle"); }} onKeyDown={(event) => { if (event.key === "Enter") searchFromHeader(); }} placeholder={t.search} aria-label={t.search} />{vinStatus !== "idle" && vinStatus !== "loading" && <span className={`global-search-feedback ${vinStatus}`}>{vinStatus === "invalid" ? t.vehicle.vinInvalid : vinStatus === "missing" ? t.vehicle.vinMissing : vinStatus === "found" ? t.vehicle.vinFound : t.vehicle.vinError}</span>}</label>
          <div className="top-actions"><Select value={themeMode} onValueChange={(value) => selectThemeMode(value as ThemeMode)}><SelectTrigger className="theme-select" aria-label={t.theme}>{theme === "light" ? <Sun size={17} /> : <Moon size={17} />}<SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">{t.auto}</SelectItem><SelectItem value="light">{t.light}</SelectItem><SelectItem value="dark">{t.dark}</SelectItem></SelectContent></Select><Button variant="ghost" className="language-button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")} aria-label={t.switchLanguage}><Globe2 size={18} /><span>{locale === "ar" ? "EN" : "العربية"}</span></Button><Button variant="ghost" size="icon" className="notification-button" aria-label={t.notifications}><Bell size={20} /><i>3</i></Button><div className="avatar" aria-hidden="true">{t.profileInitial}</div></div>
        </header>

        <div className="content">
          <section className="welcome-row"><div className="welcome-copy"><p className="eyebrow">{t.live}<CheckCircle2 size={15} /></p><h1>{t.command}</h1><p>{t.intro}</p><div className="trust-line"><span><ShieldCheck size={15} />{t.protected}</span><span><Gauge size={15} />{t.branch}</span>{dashboardError ? <span className="data-warning"><AlertTriangle size={15} />{t.unavailable}</span> : <span><RefreshCw size={15} />{t.updated}: {dashboard ? new Intl.DateTimeFormat(locale === "ar" ? "ar-SA" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(new Date(dashboard.updatedAt)) : t.refreshing}</span>}</div></div><div className="welcome-emblem" aria-hidden="true"><Image src="/rakaez-logo-gold.png" alt="" width={144} height={144} priority unoptimized sizes="(max-width: 760px) 88px, 144px" /></div><div className="date-block"><small>{calendar.weekday}</small><div className="calendar-lines"><span>{calendar.gregorian}</span><span>{calendar.hijri}</span></div></div></section>
          {view === "invoices" ? <InvoiceView locale={locale} /> : view === "cash" ? <CashControlView locale={locale} /> : <><section className="vehicle-finder" aria-labelledby="vehicle-finder-title"><div className="vehicle-finder-heading"><div className="vehicle-finder-icon"><CarFront size={23} /></div><div className="vehicle-finder-copy"><h2 id="vehicle-finder-title">{t.vehicle.title}</h2><p>{t.vehicle.hint}</p><div className="compact-vin-search"><label htmlFor="vehicle-vin">{t.vehicle.vin}</label><div><Input id="vehicle-vin" dir="ltr" inputMode="text" autoComplete="off" maxLength={17} value={vinQuery} onChange={(event) => { setVinQuery(normalizeIdentifierInput(event.target.value)); setVinStatus("idle"); }} onKeyDown={(event) => { if (event.key === "Enter") void lookupVin(vinQuery); }} placeholder={t.vehicle.vinPlaceholder} aria-label={t.vehicle.vin} /><Button type="button" size="icon" onClick={() => void lookupVin(vinQuery)} aria-label={t.vehicle.vinAction}><Search size={16} /></Button></div>{vinStatus !== "idle" && vinStatus !== "loading" && <small className={vinStatus}>{vinStatus === "invalid" ? t.vehicle.vinInvalid : vinStatus === "missing" ? t.vehicle.vinMissing : vinStatus === "found" ? t.vehicle.vinFound : t.vehicle.vinError}</small>}</div></div></div><div className="vehicle-fields">
            <div className="vehicle-field vehicle-make-field"><label htmlFor="vehicle-make-search">{t.vehicle.make}</label><Input id="vehicle-make-search" value={vehicleMakeQuery} onFocus={() => setMakeSuggestionsOpen(true)} onBlur={() => window.setTimeout(() => setMakeSuggestionsOpen(false), 120)} onChange={(event) => { const value = event.target.value; setVehicleMakeQuery(value); setVehicleMake(""); setVehicleModel(""); setVehicleYear(""); setVehicleEngine(""); setVehicleApplied(false); setMakeSuggestionsOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter" && matchingVehicleMakes[0]) { event.preventDefault(); selectVehicleMake(matchingVehicleMakes[0]); } if (event.key === "Escape") setMakeSuggestionsOpen(false); }} placeholder={t.vehicle.choose} autoComplete="off" aria-autocomplete="list" aria-controls="vehicle-make-suggestions" aria-expanded={makeSuggestionsOpen} />{makeSuggestionsOpen && matchingVehicleMakes.length > 0 && <div id="vehicle-make-suggestions" className="vehicle-make-suggestions" role="listbox" aria-label={t.vehicle.suggestions}>{matchingVehicleMakes.map((make) => <button type="button" role="option" aria-selected={vehicleMake === make} key={make} onMouseDown={(event) => event.preventDefault()} onClick={() => selectVehicleMake(make)}><b dir="ltr">{make}</b>{locale === "ar" && <span>{vehicleBrandArabic[make]}</span>}</button>)}</div>}</div>
            <div className="vehicle-field"><label>{t.vehicle.model}</label><Select key={vehicleMake || "model-disabled"} value={vehicleModel} disabled={!vehicleMake} onValueChange={(value) => { setVehicleModel(value); setVehicleYear(""); setVehicleEngine(""); setVehicleApplied(false); }}><SelectTrigger aria-label={t.vehicle.model}><span className={`vehicle-selected-value ${vehicleModel ? "" : "placeholder"}`} dir={vehicleModel ? "ltr" : rtl ? "rtl" : "ltr"}>{vehicleModel || t.vehicle.choose}</span></SelectTrigger><SelectContent>{vehicleMake ? vehicleOptions[vehicleMake as keyof typeof vehicleOptions].map((model) => <SelectItem key={`${vehicleMake}-${model}`} value={model}>{model}</SelectItem>) : null}</SelectContent></Select></div>
            <div className="vehicle-field"><label>{t.vehicle.year}</label><Select value={vehicleYear} disabled={!vehicleModel} onValueChange={(value) => { setVehicleYear(value); setVehicleEngine(""); setVehicleApplied(false); }}><SelectTrigger aria-label={t.vehicle.year}><span className={`vehicle-selected-value ${vehicleYear ? "" : "placeholder"}`} dir="ltr">{vehicleYear || t.vehicle.choose}</span></SelectTrigger><SelectContent>{vehicleModelYears.map((year) => <SelectItem key={year} value={year}>{year}</SelectItem>)}</SelectContent></Select></div>
            <div className="vehicle-field"><label>{t.vehicle.engine}</label><Select value={vehicleEngine} disabled={!vehicleYear} onValueChange={(value) => { setVehicleEngine(value); setVehicleApplied(false); }}><SelectTrigger aria-label={t.vehicle.engine}><span className={`vehicle-selected-value ${vehicleEngine ? "" : "placeholder"}`} dir={vehicleEngine ? "ltr" : rtl ? "rtl" : "ltr"}>{vehicleEngine || t.vehicle.choose}</span></SelectTrigger><SelectContent>{vehicleEngines.map((engine) => <SelectItem key={engine} value={engine}>{engine}</SelectItem>)}</SelectContent></Select></div>
            <Button className="vehicle-search-button" disabled={!vehicleMake || !vehicleModel || !vehicleYear || !vehicleEngine} onClick={() => setVehicleApplied(true)}><Search size={17} />{t.vehicle.action}</Button>{vehicleApplied && <Button variant="ghost" className="vehicle-clear" onClick={resetVehicle}>{t.vehicle.clear}</Button>}
          </div></section>
          <section className="metric-grid" aria-label={t.performance}>
            {[{ value: stats.totalParts.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB"), suffix: "", delta: t.catalog, icon: Boxes }, { value: stats.onHand.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB"), suffix: "", delta: `${t.reserved}: ${stats.reserved.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB")}`, icon: ShoppingCart }, { value: stats.lowStock.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB"), suffix: "", delta: t.low, icon: AlertTriangle, warn: stats.lowStock > 0 }, { value: stats.workshopRequests.toLocaleString(locale === "ar" ? "ar-SA" : "en-GB"), suffix: "", delta: t.active, icon: Wrench }].map((metric, index) => <article className={`metric-card ${metric.warn ? "warning" : ""}`} key={t.cards[index]}><div className="metric-icon"><metric.icon size={21} /></div><span>{t.cards[index]}</span><div><strong>{metric.value}</strong><small>{metric.suffix}</small></div><Badge variant="secondary">{metric.delta}</Badge></article>)}
          </section>

          <section className="main-grid">
            <article className="panel inventory-panel"><div className="panel-heading"><div><span className="section-kicker"><ArrowLeftRight size={16} />{t.inventoryText}</span><h2>{view === "inventory" ? t.stockTitle : t.inventoryTitle}</h2></div><Button variant="outline" size="sm">{t.all}</Button></div><div className="parts-table" role="table">
              {filteredParts.map((part) => <div className="part-row" role="row" key={part.number}><div className="part-symbol"><PackageCheck size={21} /></div><div className="part-name"><strong>{"name" in part ? part.name : locale === "ar" ? part.ar : part.en}</strong>{"translationFallback" in part && part.translationFallback && <small className="translation-fallback">{t.translationPending}</small>}<code dir="ltr">{part.number}</code></div><div className="stock-numbers"><span>{t.qty}</span><b>{"quantity" in part ? part.quantity : part.qty}</b><small>{t.reserved}: {part.reserved}</small></div><div className="shelf"><span>{t.shelf}</span><b dir="ltr">{part.shelf}</b></div><Badge className={`status ${part.status}`}>{part.status === "available" ? t.available : part.status === "low" ? t.low : t.out}</Badge></div>)}
              {filteredParts.length === 0 && <div className="empty-state"><Search size={28} /><p>{t.emptySearch}</p></div>}
            </div></article>
            <article className="panel workshop-panel"><div className="panel-heading"><div><span className="section-kicker"><Clock3 size={16} />{t.workshopText}</span><h2>{t.workshopTitle}</h2></div><Badge className="network-badge">B2B</Badge></div><div className="workshop-list">
              {workshops.map((request) => <div className="workshop-item" key={request.part}><div className="workshop-icon"><Wrench size={20} /></div><div className="workshop-copy"><strong>{request.name[locale]}</strong><span><CarFront size={14} />{request.vehicle[locale]}</span><code dir="ltr">{request.part}</code></div><div className="quote-box"><small>{t.eta}</small><b dir="ltr">{request.time}</b><Button size="sm">{t.quote}</Button></div></div>)}
            </div></article>
          </section>
          <section className="operations-strip">{[Warehouse, Boxes, ShoppingCart, Truck, Building2, ClipboardCheck]
            .map((Icon, index) => <div key={t.operations[index]}><Icon size={19} /><span>{t.operations[index]}</span></div>)}</section></>}
        </div>
      </section>
      {mobileOpen && <button className="scrim" aria-label={t.closeMenu} onClick={() => setMobileOpen(false)} />}
    </main>
  );
}
