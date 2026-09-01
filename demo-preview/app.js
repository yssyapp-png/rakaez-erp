const translations = {
  en: {
    demoRibbon: "LOCAL DEMO — FICTIONAL DATA — NOT PUBLISHED", brandSubtitle: "Auto parts operations", navFeatures: "Capabilities", navDemo: "Live demo", navSecurity: "Security", startDemo: "Start demo",
    eyebrow: "BUILT FOR THE SAUDI AUTO PARTS MARKET", heroTitle: "Every branch, every part and every stock movement — in one place.", heroBody: "Rakaez is a multi-branch operations platform for sales, inventory, purchasing and transfers, with precise permissions and a clear trail for every employee and device.", exploreDemo: "Explore the local demo", viewCapabilities: "View capabilities", trustTenant: "Tenant data isolation", trustBilingual: "Arabic & English", trustAudit: "Auditable operations",
    liveOperations: "LIVE BRANCH OPERATIONS", inventoryOverview: "Inventory overview", riyadhCompany: "Rakaez Company — Riyadh", systemsHealthy: "SYSTEMS HEALTHY", availableParts: "Available parts", todaySales: "Today's sales", invoice: "invoices", lowStock: "Low stock", needsAction: "Needs action", branchActivity: "Branch activity", last7Days: "Last 7 days", threeBranches: "3 branches online", updatedNow: "Updated now",
    targetAvailability: "Availability target", fastSearch: "Fast search", roleLevels: "Permission levels", auditTrail: "Operations trail", operationSystem: "ONE OPERATING SYSTEM", featuresTitle: "Everything an auto parts shop needs, without complexity.", featuresBody: "From the first receipt to sale and inter-branch transfer, under one administration and clear permissions.",
    smartSearch: "Smart part search", smartSearchBody: "By name, part number, barcode, shelf number or VIN with saved vehicle details.", branchStock: "All-branch inventory", branchStockBody: "Branch managers can find stock within the same organization and request transfers.", fastPos: "Fast point of sale", fastPosBody: "Safe stock deduction records employee, device and branch and prevents overselling.", bulkImport: "Inventory import", bulkImportBody: "Prepared for Excel and CSV imports with errors and duplicates reviewed before approval.", procurement: "Purchasing & suppliers", procurementBody: "Purchase orders, partial or full receipt, and direct inventory and cost movements.", securityControl: "Security & oversight", securityControlBody: "Tenant isolation, revocable sessions, trusted devices and security events without exposed secrets.",
    interactivePreview: "INTERACTIVE PREVIEW", workspaceTitle: "Search the way your shop team works.", workspaceBody: "Try a part number, shelf number, or the last six VIN characters. All data below is fictional.", inventorySearch: "Inventory search", branches: "Branches", transfers: "Transfers", orders: "Purchasing", reports: "Reports", generalManager: "General manager", inventoryManagement: "INVENTORY MANAGEMENT", findAnyPart: "Find any part in seconds", fakeData: "FICTIONAL DATA", searchLabel: "Part number, shelf number or VIN", search: "Search", resultFor: "SEARCH RESULT", compatible: "Fits 2016–2024", totalAvailable: "TOTAL AVAILABLE", branch: "BRANCH", shelf: "SHELF", quantity: "QTY", status: "STATUS", riyadhNorth: "Riyadh — North", currentBranch: "Current branch", available: "Available", openSale: "Open sale", riyadhEast: "Riyadh — East", requestTransfer: "Request transfer", riyadhIndustrial: "Riyadh — Industrial", low: "Low",
    builtForTrust: "BUILT FOR TRUST", securityTitle: "Each organization's data stays within its boundary.", securityBody: "The architecture is designed to isolate shop data and restrict access by role, branch and device, with session review and an audit trail.", tenantIsolation: "Multi-tenant isolation", tenantIsolationBody: "Every request is tied to the user's organization from the session.", deviceBinding: "Branch device binding", deviceBindingBody: "Managers approve devices and employees operate within their branch.", securityEvents: "Reviewable security events", securityEventsBody: "Record only necessary events without passwords or secrets.", protectedArchitecture: "Protected by default", sessionsProtected: "Protected, revocable sessions", secretsServer: "Secrets stay server-side", egressRestricted: "Restricted outbound connections", prodDisabled: "Payments and government connections disabled in demo", noCertification: "Supporting technical controls—not a certification or a guarantee against every attack.",
    readyForNext: "READY FOR THE NEXT PHASE", closingTitle: "Rakaez — smarter auto parts operations.", closingBody: "This is an unpublished local preview. The next step is completing tests and connecting a safe staging environment before any launch.", backTop: "Back to top", footerStatus: "Local demo · No customer data · No live payments"
  }
};

const arOriginals = new Map();
document.querySelectorAll('[data-i18n]').forEach((element) => arOriginals.set(element, element.textContent));

let currentLanguage = 'ar';
const toggle = document.getElementById('langToggle');
toggle.addEventListener('click', () => {
  currentLanguage = currentLanguage === 'ar' ? 'en' : 'ar';
  document.documentElement.lang = currentLanguage;
  document.documentElement.dir = currentLanguage === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    element.textContent = currentLanguage === 'ar' ? arOriginals.get(element) : (translations.en[key] || arOriginals.get(element));
  });
  toggle.textContent = currentLanguage === 'ar' ? 'EN' : 'ع';
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

const demoResults = {
  '04465-0K240': { title: 'فحمات فرامل أمامية — Toyota Hilux', en: 'Front brake pads — Toyota Hilux', number: '04465-0K240', total: 23 },
  'A-03-12': { title: 'فحمات فرامل أمامية — موقع الرف A-03-12', en: 'Front brake pads — Shelf A-03-12', number: '04465-0K240', total: 8 },
  'JH4KA8260MC000321': { title: 'قطع محفوظة لسيارة العميل — Honda Legend 1991', en: 'Saved customer vehicle parts — Honda Legend 1991', number: 'VIN •••000321', total: 6 }
};

function runSearch() {
  const input = document.getElementById('partSearch');
  const key = input.value.trim().toUpperCase();
  const found = demoResults[key] || demoResults['04465-0K240'];
  document.getElementById('resultTitle').textContent = currentLanguage === 'en' ? found.en : found.title;
  document.getElementById('resultNumber').textContent = found.number;
  document.getElementById('totalAvailable').textContent = found.total;
  const message = document.getElementById('searchMessage');
  message.textContent = currentLanguage === 'en' ? '✓ Demo search completed without connecting to production data.' : '✓ اكتمل البحث التجريبي دون الاتصال ببيانات الإنتاج.';
  document.getElementById('branchResults').animate([{ opacity: .45, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' });
}

document.getElementById('searchButton').addEventListener('click', runSearch);
document.getElementById('partSearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') runSearch(); });
document.querySelectorAll('.quick-values span').forEach((chip) => chip.addEventListener('click', () => {
  document.getElementById('partSearch').value = chip.dataset.value;
  runSearch();
}));
