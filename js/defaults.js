export const MONTHS_RO = [
  "Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie",
  "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"
];

export const MONTHS_SHORT_RO = [
  "Ian", "Feb", "Mar", "Apr", "Mai", "Iun",
  "Iul", "Aug", "Sep", "Oct", "Noi", "Dec"
];

export const DAYS_RO = [
  "Duminică", "Luni", "Marți", "Miercuri", "Joi", "Vineri", "Sâmbătă"
];

export const SHARED_OWNER = "comun";

export const PAYMENT_METHODS = [
  "Card",
  "Numerar",
  "Transfer bancar",
  "Tichete de masă",
  "Card de credit",
  "Altă metodă"
];

export const TX_TYPES = {
  cheltuiala: { id: "cheltuiala", label: "Cheltuială", icon: "💸", defaultDir: "out" },
  venit: { id: "venit", label: "Venit", icon: "💵", defaultDir: "in" },
  transfer: { id: "transfer", label: "Transfer", icon: "🔁", defaultDir: "out" },
  investitie: { id: "investitie", label: "Investiție", icon: "📈", defaultDir: "out" },
  ajustare: { id: "ajustare", label: "Ajustare sold", icon: "🛠️", defaultDir: "in" }
};

export const ACCOUNT_TYPES = [
  { id: "numerar", label: "Numerar", icon: "💵" },
  { id: "cont bancar", label: "Cont bancar", icon: "🏦" },
  { id: "economii", label: "Economii", icon: "🐷" },
  { id: "portofel", label: "Portofel digital", icon: "👛" },
  { id: "card de credit", label: "Card de credit", icon: "💳" },
  { id: "investitii", label: "Investiții", icon: "📈" },
  { id: "credit", label: "Credit", icon: "🏛️" }
];

export const DEFAULT_MEMBERS = [
  { key: "p1", email: "partener1@exemplu.test", name: "Eu", tab: "Cheltuieli Eu", color: "#2a78d6" },
  { key: "p2", email: "partener2@exemplu.test", name: "Soția", tab: "Cheltuieli Soția", color: "#eb6834" }
];

export const DEFAULT_SETTINGS = {
  partner1Name: "Eu",
  partner1Tab: "Cheltuieli Eu",
  partner1Email: "partener1@exemplu.test",
  partner2Name: "Soția",
  partner2Tab: "Cheltuieli Soția",
  partner2Email: "partener2@exemplu.test",
  baseCurrency: "RON",
  monthlyBudget: 6500,
  paymentMethods: [...PAYMENT_METHODS],
  schemaVersion: 2
};

export const DEFAULT_ACCOUNTS = [
  {
    id: "acc_banca_ron", name: "Cont Principal RON", type: "cont bancar", currency: "RON",
    initialBalance: 8500, initialDate: "", archived: false, owner: "partener1@exemplu.test", order: 1
  },
  {
    id: "acc_banca_eur", name: "Cont Economii EUR", type: "economii", currency: "EUR",
    initialBalance: 2400, initialDate: "", archived: false, owner: "comun", order: 2
  },
  {
    id: "acc_sotie_ron", name: "Cont Partener RON", type: "cont bancar", currency: "RON",
    initialBalance: 6200, initialDate: "", archived: false, owner: "partener2@exemplu.test", order: 3
  },
  {
    id: "acc_cash_ron", name: "Portofel Numerar", type: "numerar", currency: "RON",
    initialBalance: 600, initialDate: "", archived: false, owner: "comun", order: 4
  },
  {
    id: "acc_invest_eur", name: "Cont Investiții EUR", type: "investitii", currency: "EUR",
    initialBalance: 1500, initialDate: "", archived: false, owner: "comun", order: 5
  },
  {
    id: "acc_credit_casa", name: "Credit Ipotecar", type: "credit", currency: "EUR",
    initialBalance: -45000, initialDate: "", archived: false, owner: "comun", order: 6
  }
];

export const DEFAULT_CATEGORIES = [
  // Categorii cheltuieli (contract v4)
  { id: "alimente", name: "Alimente & Supermarket", emoji: "🛒", icon: "🛒", color: "#1baf7a", budget: 2000, active: true, order: 1, type: "cheltuiala", kind: "cheltuiala" },
  { id: "restaurante", name: "Restaurante & Cafenele", emoji: "🍽️", icon: "🍽️", color: "#eb6834", budget: 500, active: true, order: 2, type: "cheltuiala", kind: "cheltuiala" },
  { id: "livrari", name: "Livrări mâncare", emoji: "🛵", icon: "🛵", color: "#e34948", budget: 0, active: true, order: 3, type: "cheltuiala", kind: "cheltuiala" },
  { id: "locuinta", name: "Chirie / Rată casă", emoji: "🏠", icon: "🏠", color: "#2a78d6", budget: 2500, active: true, order: 4, type: "cheltuiala", kind: "cheltuiala" },
  { id: "utilitati", name: "Utilități (curent, gaz, apă)", emoji: "💡", icon: "💡", color: "#eda100", budget: 700, active: true, order: 5, type: "cheltuiala", kind: "cheltuiala" },
  { id: "telefon", name: "Telefon & Internet", emoji: "📱", icon: "📱", color: "#6250d6", budget: 200, active: true, order: 6, type: "cheltuiala", kind: "cheltuiala" },
  { id: "abonamente", name: "Abonamente & Streaming", emoji: "📺", icon: "📺", color: "#e87ba4", budget: 150, active: true, order: 7, type: "cheltuiala", kind: "cheltuiala" },
  { id: "combustibil", name: "Combustibil", emoji: "⛽", icon: "⛽", color: "#52514e", budget: 500, active: true, order: 8, type: "cheltuiala", kind: "cheltuiala" },
  { id: "masina", name: "Mașină (service, ITP, RCA, parcare)", emoji: "🚗", icon: "🚗", color: "#2a78d6", budget: 400, active: true, order: 9, type: "cheltuiala", kind: "cheltuiala" },
  { id: "transport", name: "Transport public & Taxi", emoji: "🚌", icon: "🚌", color: "#1baf7a", budget: 300, active: true, order: 10, type: "cheltuiala", kind: "cheltuiala" },
  { id: "sanatate", name: "Sănătate & Farmacie", emoji: "💊", icon: "💊", color: "#e34948", budget: 400, active: true, order: 11, type: "cheltuiala", kind: "cheltuiala" },
  { id: "ingrijire", name: "Îngrijire personală & Cosmetice", emoji: "🧴", icon: "🧴", color: "#e87ba4", budget: 300, active: true, order: 12, type: "cheltuiala", kind: "cheltuiala" },
  { id: "haine", name: "Haine & Încălțăminte", emoji: "👕", icon: "👕", color: "#6250d6", budget: 400, active: true, order: 13, type: "cheltuiala", kind: "cheltuiala" },
  { id: "casa", name: "Casă & Curățenie", emoji: "🧹", icon: "🧹", color: "#1baf7a", budget: 350, active: true, order: 14, type: "cheltuiala", kind: "cheltuiala" },
  { id: "mobila", name: "Mobilă & Electrocasnice", emoji: "🛋️", icon: "🛋️", color: "#eda100", budget: 0, active: true, order: 15, type: "cheltuiala", kind: "cheltuiala" },
  { id: "electronice", name: "Electronice & Gadgeturi", emoji: "💻", icon: "💻", color: "#2a78d6", budget: 300, active: true, order: 16, type: "cheltuiala", kind: "cheltuiala" },
  { id: "copii", name: "Copii", emoji: "🧸", icon: "🧸", color: "#e87ba4", budget: 500, active: true, order: 17, type: "cheltuiala", kind: "cheltuiala" },
  { id: "animale", name: "Animale de companie", emoji: "🐾", icon: "🐾", color: "#eb6834", budget: 200, active: true, order: 18, type: "cheltuiala", kind: "cheltuiala" },
  { id: "educatie", name: "Educație & Cursuri", emoji: "🎓", icon: "🎓", color: "#6250d6", budget: 250, active: true, order: 19, type: "cheltuiala", kind: "cheltuiala" },
  { id: "hobby", name: "Cărți & Hobby", emoji: "📚", icon: "📚", color: "#1baf7a", budget: 0, active: true, order: 20, type: "cheltuiala", kind: "cheltuiala" },
  { id: "divertisment", name: "Divertisment & Ieșiri", emoji: "🎬", icon: "🎬", color: "#e34948", budget: 300, active: true, order: 21, type: "cheltuiala", kind: "cheltuiala" },
  { id: "sport", name: "Sport & Fitness", emoji: "🏋️", icon: "🏋️", color: "#008300", budget: 0, active: true, order: 22, type: "cheltuiala", kind: "cheltuiala" },
  { id: "calatorii", name: "Călătorii & Vacanțe", emoji: "✈️", icon: "✈️", color: "#2a78d6", budget: 800, active: true, order: 23, type: "cheltuiala", kind: "cheltuiala" },
  { id: "cadouri", name: "Cadouri & Ocazii", emoji: "🎁", icon: "🎁", color: "#e87ba4", budget: 300, active: true, order: 24, type: "cheltuiala", kind: "cheltuiala" },
  { id: "donatii", name: "Donații", emoji: "❤️", icon: "❤️", color: "#e34948", budget: 0, active: true, order: 25, type: "cheltuiala", kind: "cheltuiala" },
  { id: "asigurari", name: "Asigurări", emoji: "🛡️", icon: "🛡️", color: "#52514e", budget: 0, active: true, order: 26, type: "cheltuiala", kind: "cheltuiala" },
  { id: "taxe", name: "Taxe, impozite & Comisioane", emoji: "🏛️", icon: "🏛️", color: "#52514e", budget: 200, active: true, order: 27, type: "cheltuiala", kind: "cheltuiala" },
  { id: "credite", name: "Credite & Datorii", emoji: "💳", icon: "💳", color: "#6250d6", budget: 0, active: true, order: 28, type: "cheltuiala", kind: "cheltuiala" },
  { id: "reparatii", name: "Reparații & Întreținere", emoji: "🔧", icon: "🔧", color: "#eda100", budget: 0, active: true, order: 29, type: "cheltuiala", kind: "cheltuiala" },
  { id: "bauturi", name: "Băuturi & Tutun", emoji: "🍷", icon: "🍷", color: "#eb6834", budget: 0, active: true, order: 30, type: "cheltuiala", kind: "cheltuiala" },
  { id: "altele", name: "Altele", emoji: "📦", icon: "📦", color: "#8a8984", budget: 200, active: true, order: 31, type: "cheltuiala", kind: "cheltuiala" },
  // Categorii venituri (contract v4)
  { id: "salariu", name: "Salariu", emoji: "💼", icon: "💼", color: "#1baf7a", budget: 0, active: true, order: 32, type: "venit", kind: "venit" },
  { id: "bonus", name: "Bonusuri & Prime", emoji: "🎉", icon: "🎉", color: "#2a78d6", budget: 0, active: true, order: 33, type: "venit", kind: "venit" },
  { id: "rambursari", name: "Rambursări", emoji: "↩️", icon: "↩️", color: "#6250d6", budget: 0, active: true, order: 34, type: "venit", kind: "venit" },
  { id: "dobanzi", name: "Dobânzi & Dividende", emoji: "📈", icon: "📈", color: "#008300", budget: 0, active: true, order: 35, type: "venit", kind: "venit" },
  { id: "chirii-incasate", name: "Chirii încasate", emoji: "🏘️", icon: "🏘️", color: "#eda100", budget: 0, active: true, order: 36, type: "venit", kind: "venit" },
  { id: "cadouri-primite", name: "Cadouri primite", emoji: "🎁", icon: "🎁", color: "#e87ba4", budget: 0, active: true, order: 37, type: "venit", kind: "venit" },
  { id: "vanzari", name: "Vânzări", emoji: "🏷️", icon: "🏷️", color: "#eb6834", budget: 0, active: true, order: 38, type: "venit", kind: "venit" },
  { id: "alte-venituri", name: "Alte venituri", emoji: "💰", icon: "💰", color: "#52514e", budget: 0, active: true, order: 39, type: "venit", kind: "venit" }
];

export const DEFAULT_CURRENCIES = [
  { code: "RON", name: "Leu românesc", symbol: "lei", rate: 1.0, updated: "" },
  { code: "EUR", name: "Euro", symbol: "€", rate: 5.0, updated: "" },
  { code: "USD", name: "Dolar american", symbol: "$", rate: 4.4, updated: "" },
  { code: "GBP", name: "Liră sterlină", symbol: "£", rate: 5.8, updated: "" },
  { code: "CHF", name: "Franc elvețian", symbol: "CHF", rate: 5.4, updated: "" },
  { code: "HUF", name: "Forint maghiar", symbol: "Ft", rate: 0.013, updated: "" },
  { code: "MDL", name: "Leu moldovenesc", symbol: "MDL", rate: 0.26, updated: "" }
];

export const DEFAULT_MERCHANTS = [
  { name: "Supermarket Demo", category: "alimente" },
  { name: "Farmacie Demo", category: "sanatate" },
  { name: "Furnizor Utilități Demo", category: "utilitati" },
  { name: "Cafenea Demo", category: "restaurante" }
];

function fmtOffsetDate(monthsAgo, day) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, Math.min(day, 28));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function createDemoExpenses() {
  const todayDay = Math.min(new Date().getDate(), 28);
  const d = (offset) => Math.max(1, todayDay - offset);

  return [
    {
      id: "demo_inc_1", date: fmtOffsetDate(0, 1), type: "venit",
      amount: 7200, currency: "RON", rate: 1, baseAmount: 7200,
      category: "salariu", description: "Salariu lunar (sintetic)", merchant: "Angajator Demo",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "partener1@exemplu.test", bill: "", source: "demo:inc1",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_inc_2", date: fmtOffsetDate(0, 2), type: "venit",
      amount: 5800, currency: "RON", rate: 1, baseAmount: 5800,
      category: "salariu", description: "Salariu partener (sintetic)", merchant: "Companie Demo",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_sotie_ron", toAccount: "", toAmount: null,
      payer: "partener2@exemplu.test", bill: "", source: "demo:inc2",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_1", date: fmtOffsetDate(0, d(0)), type: "cheltuiala",
      amount: 342.5, currency: "RON", rate: 1, baseAmount: 342.5,
      category: "alimente", description: "Cumpărături săptămânale", merchant: "Supermarket Demo",
      method: "Card", isPrivate: false,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp1",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_2", date: fmtOffsetDate(0, d(1)), type: "cheltuiala",
      amount: 185, currency: "RON", rate: 1, baseAmount: 185,
      category: "sanatate", description: "Vitamine & farmacie", merchant: "Farmacie Demo",
      method: "Card", isPrivate: false,
      account: "acc_sotie_ron", toAccount: "", toAmount: null,
      payer: "partener2@exemplu.test", bill: "", source: "demo:exp2",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_tr_1", date: fmtOffsetDate(0, d(2)), type: "transfer",
      amount: 1500, currency: "RON", rate: 1, baseAmount: 1500,
      category: "", description: "Transfer economii EUR (un singur rând v4)", merchant: "",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_banca_ron", toAccount: "acc_banca_eur", toAmount: 300,
      payer: "comun", bill: "", source: "demo:tr1",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_inv_1", date: fmtOffsetDate(0, d(3)), type: "investitie",
      amount: 200, currency: "EUR", rate: 5.0, baseAmount: 1000,
      category: "", description: "Contribuție lunară ETF (sintetic)", merchant: "Broker Demo",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_banca_eur", toAccount: "acc_invest_eur", toAmount: 200,
      payer: "comun", bill: "", source: "demo:inv1",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_4", date: fmtOffsetDate(0, d(3)), type: "cheltuiala",
      amount: 310, currency: "RON", rate: 1, baseAmount: 310,
      category: "combustibil", description: "Alimentare combustibil", merchant: "Stație Demo",
      method: "Card", isPrivate: false,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "partener1@exemplu.test", bill: "", source: "demo:exp4",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_5", date: fmtOffsetDate(0, d(4)), type: "cheltuiala",
      amount: 245, currency: "RON", rate: 1, baseAmount: 245,
      category: "restaurante", description: "Cină în oraș", merchant: "Restaurant Demo",
      method: "Card", isPrivate: false,
      account: "acc_sotie_ron", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp5",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_6", date: fmtOffsetDate(0, d(5)), type: "cheltuiala",
      amount: 289.4, currency: "RON", rate: 1, baseAmount: 289.4,
      category: "utilitati", description: "Factură curent & internet", merchant: "Furnizor Utilități Demo",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp6",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_7", date: fmtOffsetDate(0, d(6)), type: "cheltuiala",
      amount: 220, currency: "RON", rate: 1, baseAmount: 220,
      category: "cadouri", description: "Cadou surpriză (Privat)", merchant: "Magazin Demo",
      method: "Card", isPrivate: true,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "partener1@exemplu.test", bill: "", source: "demo:exp7",
      owner: "partener1@exemplu.test"
    },
    {
      id: "demo_refund", date: fmtOffsetDate(0, d(6)), type: "venit",
      amount: 45, currency: "RON", rate: 1, baseAmount: 45,
      category: "rambursari", description: "Retur produs", merchant: "Supermarket Demo",
      method: "Card", isPrivate: false,
      account: "acc_sotie_ron", toAccount: "", toAmount: null,
      payer: "partener2@exemplu.test", bill: "", source: "demo:ref1",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_9", date: fmtOffsetDate(0, d(8)), type: "cheltuiala",
      amount: 16.99, currency: "EUR", rate: 5.0, baseAmount: 84.95,
      category: "abonamente", description: "Abonament streaming", merchant: "Streaming Demo",
      method: "Card", isPrivate: false,
      account: "acc_banca_eur", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp9",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_11", date: fmtOffsetDate(1, 10), type: "cheltuiala",
      amount: 920, currency: "RON", rate: 1, baseAmount: 920,
      category: "alimente", description: "Aprovizionare luna trecută", merchant: "Supermarket Demo",
      method: "Card", isPrivate: false,
      account: "acc_sotie_ron", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp11",
      owner: "partener2@exemplu.test"
    },
    {
      id: "demo_12", date: fmtOffsetDate(1, 14), type: "cheltuiala",
      amount: 410, currency: "RON", rate: 1, baseAmount: 410,
      category: "utilitati", description: "Utilități luna trecută", merchant: "Furnizor Utilități Demo",
      method: "Transfer bancar", isPrivate: false,
      account: "acc_banca_ron", toAccount: "", toAmount: null,
      payer: "comun", bill: "", source: "demo:exp12",
      owner: "partener1@exemplu.test"
    }
  ];
}
