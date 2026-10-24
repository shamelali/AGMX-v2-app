/* ============================================================
   AGMX — SaaS Cooperative Governance Operating System
   Single-page app with multi-role views, AI Copilot, offline-first.
   Now with built-in i18n (BM / EN toggle via state.lang).
   ------------------------------------------------------------
   To switch language: click the EN link in the header, or
   visit app.html?lang=en (or ?lang=ms for Malay).
   ------------------------------------------------------------
   For licence and full docs see: https://github.com/shamelali/AGMX
   ============================================================ */

/* ---- Data store (Malay base) ---- */
const D = window.MC_DATA || {
	cooperative: { id: "KPM-0000", name: "Koperasi", plan: "Enterprise", members: 0, quorumPct: 25, quorumRequired: 0, uukRef: "UUK/v1" },
	currentUser: { id: "U-0000", name: "Pengguna", role: "Pentadbir", avatar: "PG", phone: "", email: "", language: "BM" },
	members: [], agm: { id: "AGM-0000", title: "AGM", edition: "", date: "", time: "", venue: "", mode: "", status: "", startedAt: "", elapsed: "00:00", quorumPct: 0, quorumRequired: 0, quorumPresent: 0, totalMembers: 0, lateNoticeDays: 21, noticesSent: 0, noticesRead: 0, noticesOpened: 0 },
	agenda: [], candidates: [], motions: [{ id: "M-000", title: "Menunggu data", status: "Draf", type: "Biasa", proposer: "-", seconder: "-", proposedAt: "-", votes: { ya: 0, tidak: 0, abstain: 0 }, discussion: [] }], questions: [], actions: [], auditLog: [], health: { activeSessions: 0, wsLatency: 0, bandwidth: 0 }, compliance: { score: 0, aktaChips: [] },
	financialSummary: { revenue: "RM 0", netProfit: "RM 0", dividend: "0%", totalAssets: "RM 0", totalLiabilities: "RM 0", yoyProfit: "0%" },
	languages: ["Bahasa Melayu", "English"],
};

// ---- i18n ----
const I = {
	BM: {
		dashboard: "Papan Pemuka",
		agmHall: "Dewan AGM",
		agendaFilter: { all: "Semua", opening: "Pengenalan", compliance: "Penegasan Kuorum", financial: "Penyata Kewangan", report: "Laporan Tahunan", election: "Pilihan Raya", motions: "Usul-Usul", closing: "Penutup" },
		motionTypes: { biasa: "Biasa", resolution: "Resolusi" },
		navLabels: { dashboard: "Papan Pemuka", agmHall: "Dewan AGM", members: "Ahli & Organisasi", copilot: "AI Copilot", compliance: "Pematuhan", settings: "Tetapan", vault: "Digital Vault", roadmap: "Roadmap", wizard: "AGM Wizard" },
		viewOpening: "Papers", viewQuorum: "Kuorum", viewFinancial: "Penyata Kewangan", viewReport: "Laporan", viewElection: "Pilihan Raya", viewMotions: "Usul-Usul", viewClosing: "Penutup",
		errorUnexpected: "Ralat Tidak Dijangka", errorRetry: "Muat Semula",
		btnReload: "Muat Semula",
		statusActive: "Aktif", statusArrears: "Tunggakan",
		seniorMode: "Mod Warga Emas",
		themeDark: "Mod Gelap", themeLight: "Mod Cerah",
		langToggle: "Tukar ke English",
		// AGM agenda items
		agendaAgung: "Pengerusian & Ucapan Alu-aluan",
		agendaQuorum: "Pengesahan Kuorum & Notis Mesyuarat",
		agendaMinutes: "Pengesahan Minit AGM Ke-15",
		agendaFinancial: "Penyata Kewangan 2025",
		agendaReport: "Laporan Tahunan & Pencapaian",
		agendaDividend: "Pembagian Dividen & Lebih Surplus",
		agendaElection: "Pilihan Raya Lembaga Pengarah 2026-2029",
		agendaMemberSuggestion: "Usul-Usul Ahli",
		agendaClosing: "Hal-Hal Lain & Penutup",
	},
	EN: {
		dashboard: "Dashboard",
		agmHall: "AGM Hall",
		agendaFilter: { all: "All", opening: "Opening", compliance: "Quorum", financial: "Financial Summary", report: "Annual Report", election: "Election", motions: "Motions", closing: "Closing" },
		motionTypes: { biasa: "Standard", resolution: "Resolution" },
		navLabels: { dashboard: "Dashboard", agmHall: "AGM Hall", members: "Members & Organization", copilot: "AI Copilot", compliance: "Compliance", settings: "Settings", vault: "Digital Vault", roadmap: "Roadmap", wizard: "AGM Wizard" },
		viewOpening: "Papers", viewQuorum: "Quorum", viewFinancial: "Financial Summary", viewReport: "Annual Report", viewElection: "Election", viewMotions: "Motions", viewClosing: "Closing",
		errorUnexpected: "Unexpected Error", errorRetry: "Reload",
		btnReload: "Reload",
		statusActive: "Active", statusArrears: "Arrears",
		seniorMode: "Senior Citizen Mode",
		themeDark: "Dark Mode", themeLight: "Light Mode",
		langToggle: "Switch to English",
		// AGM agenda items
		agendaAgung: "Chairmanship & Welcome Address",
		agendaQuorum: "Quorum & Meeting Notice Confirmation",
		agendaMinutes: "Confirmation of 15th AGM Minutes",
		agendaFinancial: "Financial Statement Presentation 2025",
		agendaReport: "Annual Report & Achievements",
		agendaDividend: "Dividend Distribution & Surplus",
		agendaElection: "Directors Election 2026-2029",
		agendaMemberSuggestion: "Member Motions",
		agendaClosing: "Other Matters & Closing",
	},
};

// Helper: resolve any i18n string (dot-path or nested)
function __(k) {
	if (!k) return "";
	const parts = k.split(".");
	let obj = I[state.lang] || I.BM;
	for (const p of parts) {
		if (obj && typeof obj === "object") obj = obj[p];
		else return k;
	}
	return obj || k;
}

// ---- App state (BM base, toggleable) ----
const state = {
	view: "dashboard",
	mode: "light",
	theme: "light",
	sidebarOpen: false,
	seniorMode: false,
	agendaFilter: "all",
	lang: "BM", // "BM" or "EN"
};

// Map internal lang key to I lookup
const langMap = { BM: "BM", EN: "EN" };

// ---- DOM ready ----
document.addEventListener("DOMContentLoaded", () => {
	// detect lang from URL ?lang=en or ?lang=ms
	const urlParams = new URLSearchParams(location.search);
	if (urlParams.get("lang")) state.lang = urlParams.get("lang") === "en" ? "EN" : "BM";
	else {
		try { state.lang = localStorage.getItem("agmx-lang") === "en" ? "EN" : "BM"; } catch (_) {}
	}
	// also detect from app-en.html alias
	if (location.pathname.includes("en")) state.lang = "EN";

	// Set HTML lang attribute
	document.documentElement.lang = state.lang === "BM" ? "ms" : "en";

	// render dashboard labels
	renderNavLabels();
	renderAgendaFilter();

	// theme toggle (optional — shell may not include it yet)
	const themeToggle = document.getElementById("theme-toggle");
	if (themeToggle) themeToggle.addEventListener("click", () => {
		state.theme = state.theme === "dark" ? "light" : "dark";
		document.body.setAttribute("data-theme", state.theme);
		themeToggle.setAttribute("title", __("theme" + (state.theme === "dark" ? "Dark" : "Light")));
		themeToggle.textContent = state.theme === "dark" ? "Light" : "Dark";
	});

	// lang switch in header
	const langSwitch = document.querySelector(".lang-switch");
	if (langSwitch) {
		langSwitch.textContent = state.lang === "BM" ? "EN" : "BM";
		langSwitch.title = __("langToggle");
		langSwitch.href = state.lang === "BM" ? "app.html?lang=en" : "app.html?lang=ms";
		langSwitch.addEventListener("click", e => {
			e.preventDefault();
			state.lang = state.lang === "BM" ? "EN" : "BM";
			try { localStorage.setItem("agmx-lang", state.lang === "EN" ? "en" : "ms"); } catch (_) {}
			history.replaceState(null, "", `?lang=${state.lang === "EN" ? "en" : "ms"}`);
			// Update HTML lang attribute
			document.documentElement.lang = state.lang === "BM" ? "ms" : "en";
			renderNavLabels();
			renderAgendaFilter();
		});
	}

	// senior mode toggle (optional)
	const seniorToggle = document.getElementById("senior-toggle");
	if (seniorToggle) seniorToggle.addEventListener("click", () => {
		state.seniorMode = !state.seniorMode;
		document.body.classList.toggle("senior-mode", state.seniorMode);
	});

	// init theme from preference or stored
	if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
		state.theme = "dark"; document.body.setAttribute("data-theme", "dark");
	}
});

// ---- render helpers ----
function renderNavLabels() {
	const nav = document.querySelectorAll(".nav-item span, .nav-badge, .h-title, .h-subtitle");
	nav.forEach(el => {
		const key = el.dataset.i18n || el.getAttribute("data-i18n");
		if (key) el.textContent = __(`navLabels.${key}`);
	});
}

// AGM agenda filter labels
function renderAgendaFilter() {
	const filters = document.querySelectorAll('.agenda-filter .filter-btn');
	filters.forEach(f => {
		const key = f.dataset.filter;
		if (key && I[state.lang].agendaFilter) f.textContent = I[state.lang].agendaFilter[key] || key;
	});
}

// Export for inline HTML usage
window.__ = __;
window.I = I;
window.D = D;
window.state = state;