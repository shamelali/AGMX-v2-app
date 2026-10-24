// AGMX Mock Data — simulates a Malaysian cooperative governance system
// All names and figures are fictitious, used for demonstration only.

window.MC_DATA = {
  cooperative: {
    id: "KPM-2024-00142",
    name: "Koperasi Pekerja Maju Berhad",
    shortName: "KOPEMAJU",
    registrationNo: "KPM-142/2010",
    state: "Selangor",
    zone: "Petaling Jaya",
    members: 1284,
    quorumPct: 25,
    quorumRequired: 322,
    uukRef: "UUK/2018/v3.2",
    logoText: "KM",
    logoColor: "#0B5394",
    founded: "2010",
    plan: "Enterprise",
    renewalDate: "31 Disember 2026",
  },

  currentUser: {
    id: "U-0042",
    name: "Pn. Aishah Rahman",
    role: "Setiausaha (Secretary)",
    avatar: "AR",
    memberId: "A-0042",
    phone: "+60 12-*** 8821",
    email: "aishah@kopemaju.my",
    language: "BM",
  },

  members: [
    { id: "A-0042", name: "Pn. Aishah Rahman", ic: "80****-**-****", shares: 1200, status: "Aktif", arrears: 0, eligible: true, age: 56, proxy: null, attended: true, joined: "2012-03-14" },
    { id: "A-0117", name: "En. Lim Chong Wei", ic: "71****-**-****", shares: 850, status: "Aktif", arrears: 0, eligible: true, age: 49, proxy: null, attended: true, joined: "2014-07-02" },
    { id: "A-0233", name: "Cik Nurul Huda Bt Ali", ic: "92****-**-****", shares: 600, status: "Aktif", arrears: 0, eligible: true, age: 32, proxy: null, attended: true, joined: "2019-01-22" },
    { id: "A-0078", name: "En. Muthusamy a/l Gopal", ic: "65****-**-****", shares: 2400, status: "Aktif", arrears: 0, eligible: true, age: 71, proxy: "A-0233", attended: true, joined: "2008-05-09" },
    { id: "A-0312", name: "Pn. Fatimah Bt Ismail", ic: "68****-**-****", shares: 1500, status: "Aktif", arrears: 0, eligible: true, age: 73, proxy: null, attended: true, joined: "2010-11-30" },
    { id: "A-0044", name: "En. Razak Bin Hussein", ic: "75****-**-****", shares: 900, status: "Tunggakan", arrears: 240, eligible: false, age: 48, proxy: null, attended: false, joined: "2015-04-18" },
    { id: "A-0201", name: "Cik Tan Mei Ling", ic: "94****-**-****", shares: 300, status: "Aktif", arrears: 0, eligible: true, age: 30, proxy: null, attended: true, joined: "2021-08-01" },
    { id: "A-0099", name: "En. Vijay Kumar", ic: "70****-**-****", shares: 1750, status: "Aktif", arrears: 0, eligible: true, age: 52, proxy: null, attended: true, joined: "2011-02-19" },
    { id: "A-0067", name: "Pn. Saraswathi Devi", ic: "62****-**-****", shares: 2200, status: "Aktif", arrears: 0, eligible: true, age: 68, proxy: "A-0099", attended: true, joined: "2009-09-25" },
    { id: "A-0089", name: "En. Faizal Bin Ahmad", ic: "78****-**-****", shares: 1100, status: "Tunggakan", arrears: 180, eligible: false, age: 45, proxy: null, attended: false, joined: "2013-06-12" },
    { id: "A-0156", name: "Pn. Wong Soke Yen", ic: "85****-**-****", shares: 1450, status: "Aktif", arrears: 0, eligible: true, age: 39, proxy: null, attended: true, joined: "2016-10-05" },
    { id: "A-0287", name: "En. Mohd Firdaus", ic: "88****-**-****", shares: 800, status: "Aktif", arrears: 0, eligible: true, age: 36, proxy: null, attended: true, joined: "2018-12-08" },
    { id: "A-0501", name: "Pn. Zaiton Bt Mohd", ic: "60****-**-****", shares: 2600, status: "Aktif", arrears: 0, eligible: true, age: 75, proxy: "A-0312", attended: true, joined: "2007-03-22" },
  ],

  agm: {
    id: "AGM-2026-001",
    title: "Mesyuarat Agung Tahunan Ke-16",
    edition: "AGM Ke-16 (Tahun Kewangan 2025)",
    date: "23 Jun 2026",
    time: "09:00 – 13:00",
    venue: "Dewan Korporat KOPEMAJU, Petaling Jaya",
    mode: "Hibrid (Fizikal + Dalam Talian)",
    status: "LIVE",
    startedAt: "09:04",
    elapsed: "02:18:42",
    quorumPct: 31.4,
    quorumRequired: 322,
    quorumPresent: 403,
    totalMembers: 1284,
    lateNoticeDays: 21,
    noticesSent: 1284,
    noticesRead: 1197,
    noticesOpened: 1241,
  },

  agenda: [
    { id: "AG-01", title: "Pengerusian & Ucapan Alu-aluan", type: "Opening", duration: 10, status: "Selesai", presenter: "Pengerusi" },
    { id: "AG-02", title: "Pengesahan Kuorum & Notis Mesyuarat", type: "Compliance", duration: 5, status: "Selesai", presenter: "Setiausaha" },
    { id: "AG-03", title: "Pengesahan Minit AGM Ke-15", type: "Resolution", duration: 10, status: "Selesai", presenter: "Setiausaha" },
    { id: "AG-04", title: "Pembentangan Penyata Kewangan 2025", type: "Financial", duration: 25, status: "Selesai", presenter: "Bendahari" },
    { id: "AG-05", title: "Laporan Tahunan & Pencapaian", type: "Report", duration: 20, status: "Selesai", presenter: "Pengerusi" },
    { id: "AG-06", title: "Pembahagian Dividen & Lebih Surplus", type: "Resolution", duration: 30, status: "Sedang Berlangsung", presenter: "Bendahari" },
    { id: "AG-07", title: "Pilihan Raya Lembaga Pengarah 2026-2029", type: "Election", duration: 45, status: "Menunggu", presenter: "Suruhanjaya" },
    { id: "AG-08", title: "Usul-Usul Ahli", type: "Motions", duration: 30, status: "Menunggu", presenter: "Ahli" },
    { id: "AG-09", title: "Hal-Hal Lain & Penutup", type: "Closing", duration: 10, status: "Menunggu", presenter: "Pengerusi" },
  ],

  candidates: [
    { id: "C-01", name: "En. Lim Chong Wei", age: 49, position: "Pengerusi", votes: 287, manifesto: "Memperkasa digitalisasi koperasi & kesejahteraan ahli.", photo: "LC", color: "#0B5394", zone: "PJ Utara" },
    { id: "C-02", name: "Pn. Wong Soke Yen", age: 39, position: "Naib Pengerusi", votes: 198, manifesto: "Inovasi produk & perluasan pasaran generasi muda.", photo: "WS", color: "#7B1FA2", zone: "PJ Selatan" },
    { id: "C-03", name: "En. Muthusamy Gopal", age: 71, position: "Ahli Lembaga", votes: 165, manifesto: "Mempertahankan warisan & integriti kewangan.", photo: "MG", color: "#10B981", zone: "Petaling" },
    { id: "C-04", name: "Cik Nurul Huda Ali", age: 32, position: "Ahli Lembaga", votes: 224, manifesto: "Memperkenalkan platform e-dagang untuk ahli.", photo: "NH", color: "#F59E0B", zone: "Subang" },
    { id: "C-05", name: "Pn. Saraswathi Devi", age: 68, position: "Ahli Lembaga", votes: 142, manifesto: "Memperkukuh jaringan koperasi wanita & komuniti.", photo: "SD", color: "#E91E63", zone: "PJ Timur" },
    { id: "C-06", name: "En. Vijay Kumar", age: 52, position: "Ahli Lembaga", votes: 178, manifesto: "Latihan keusahawanan & modal insan.", photo: "VK", color: "#2196F3", zone: "Shah Alam" },
    { id: "C-07", name: "Pn. Fatimah Ismail", age: 73, position: "Ahli Lembaga", votes: 119, manifesto: "Pekhidmatan kesihatan & kebajikan veteran.", photo: "FI", color: "#9C27B0", zone: "Klang" },
    { id: "C-08", name: "En. Mohd Firdaus", age: 36, position: "Ahli Lembaga", votes: 156, manifesto: "Transformasi teknologi & keselamatan siber.", photo: "MF", color: "#FF5722", zone: "PJ Barat" },
  ],

  motions: [
    {
      id: "M-001", title: "Pembahagian Dividen 8% daripada Lebih Surplus RM1.42 Juta",
      proposer: "A-0099 (En. Vijay Kumar)", seconder: "A-0156 (Pn. Wong Soke Yen)",
      status: "Sedang Diundi", type: "Kewangan",
      proposedAt: "11:24:18", secondedAt: "11:25:02",
      discussion: [
        { who: "A-0078", name: "En. Muthusamy", text: "Saya menyokong penuh — kadar dividen 8% adalah munasabah.", at: "11:30" },
        { who: "A-0501", name: "Pn. Zaiton (oleh proksi)", text: "Boleh penjelasan tentang formula pengiraan?", at: "11:34" },
      ],
      votes: { ya: 248, tidak: 47, abstain: 18, total: 313 },
    },
    {
      id: "M-002", title: "Pelantikan Juruaudit Luar Bertauliah Bagi TK 2026",
      proposer: "A-0117 (En. Lim)", seconder: "A-0099 (En. Vijay)", status: "Selesai — LULUS", type: "Tadbir Urus",
      proposedAt: "10:42:18", secondedAt: "10:43:55",
      discussion: [], votes: { ya: 381, tidak: 12, abstain: 8, total: 401 },
    },
    {
      id: "M-003", title: "Pindaan UUK Klausa 7.3: Kuorum Mesyuarat Agung",
      proposer: "A-0042 (Pn. Aishah)", seconder: null, status: "Gagal — Tiada Penyokong", type: "UUK",
      proposedAt: "10:55:30", secondedAt: null, discussion: [], votes: null,
    },
  ],

  questions: [
    { id: "Q-01", from: "A-0078 (En. Muthusamy)", text: "Mengapa kadar dividen lebih rendah berbanding TK 2024 (10%)?", category: "Kewangan", upvotes: 47, status: "Dijawab", answeredBy: "Bendahari" },
    { id: "Q-02", from: "A-0312 (Pn. Fatimah)", text: "Adakah koperasi akan membuka cawangan di Klang?", category: "Strategik", upvotes: 23, status: "Disatukan", grouped: 12 },
    { id: "Q-03", from: "A-0501 (Pn. Zaiton)", text: "Bagaimana mekanisme bantuan kewangan kecemasan untuk ahli?", category: "Kebajikan", upvotes: 18, status: "Dalam Antrian", grouped: 4 },
    { id: "Q-04", from: "A-0287 (En. Firdaus)", text: "Boleh jelaskan pelaburan hartanah baru di Cyberjaya?", category: "Pelaburan", upvotes: 31, status: "Dijawab", answeredBy: "Bendahari" },
  ],

  actions: [
    { id: "ACT-001", title: "Selesai pelantikan juruaudit luar & tandatangan surat setuju", pic: "Bendahari", due: "30 Jun 2026", status: "Selesai", fromMotion: "M-002" },
    { id: "ACT-002", title: "Agihkan dividen 8% kepada akaun ahli melalui eWallet", pic: "Bahagian Kewangan", due: "15 Julai 2026", status: "Dalam Tindakan", fromMotion: "M-001" },
    { id: "ACT-003", title: "Sediakan kertas kerja pindaan UUK 7.3 untuk AGM Ke-17", pic: "Setiausaha", due: "31 Dis 2026", status: "Belum Bermula", fromMotion: "M-003" },
  ],

  auditLog: [
    { ts: "11:42:18.243", actor: "A-0099", action: "VOTE_CAST", detail: "Undi YA pada M-001", hash: "0x9f4a…b8c2", ip: "10.0.4.117", sig: "✓" },
    { ts: "11:42:17.892", actor: "A-0156", action: "VOTE_CAST", detail: "Undi TIDAK pada M-001", hash: "0x9f4a…b8c1", ip: "10.0.4.156", sig: "✓" },
    { ts: "11:42:16.110", actor: "A-0078", action: "VOTE_CAST", detail: "Undi YA pada M-001", hash: "0x9f4a…b8bf", ip: "10.0.5.078", sig: "✓" },
    { ts: "11:25:02.541", actor: "A-0156", action: "MOTION_SECOND", detail: "Sokong M-001", hash: "0x9f4a…b8bd", ip: "10.0.4.156", sig: "✓" },
    { ts: "11:24:18.022", actor: "A-0099", action: "MOTION_PROPOSE", detail: "Cadang M-001 (Dividen 8%)", hash: "0x9f4a…b8bb", ip: "10.0.4.099", sig: "✓" },
    { ts: "11:18:09.310", actor: "Pengerusi", action: "STAGE_CHANGE", detail: "Buka fasa Voting Mode", hash: "0x9f4a…b8b7", ip: "—", sig: "✓" },
    { ts: "11:00:00.001", actor: "Setiausaha", action: "AGM_START", detail: "Mesyuarat dimulakan, kuorum disahkan", hash: "0x9f4a…b8b0", ip: "10.0.1.002", sig: "✓" },
  ],

  health: {
    cpu: 38, ram: 54, bandwidth: 67, db: 22,
    activeSessions: 403, queuedOTPs: 0, wsLatency: 142,
    alerts: [],
  },

  compliance: {
    score: 98,
    aktaChips: [
      { id: "Sec 17", label: "Notis Mesyuarat (≥15 hari)", status: "PATUH", evidence: "21 hari — dihantar 02 Jun 2026" },
      { id: "Sec 22", label: "Kelayakan Mengundi Ahli Aktif", status: "PATUH", evidence: "Tapis automatik (1,162 layak / 122 tidak layak)" },
      { id: "GP14", label: "Kuorum Minimum (≥25%)", status: "PATUH", evidence: "31.4% — 403 daripada 1,284 ahli" },
      { id: "GP14B", label: "Pencadang & Penyokong Usul", status: "PATUH", evidence: "Setiap usul dijejaki secara automatik" },
      { id: "UUK 7.3", label: "Tempoh Perbahasan", status: "AMARAN", evidence: "1 usul melebihi 15 minit pada M-001" },
      { id: "Akta 1993", label: "Rekod Digital Tidak Boleh Dipadam", status: "PATUH", evidence: "Immutable hash chain aktif" },
    ],
  },

  financialSummary: {
    revenue: "RM 12.84 Juta",
    netProfit: "RM 1.42 Juta",
    dividend: "8%",
    totalAssets: "RM 38.20 Juta",
    totalLiabilities: "RM 9.65 Juta",
    yoyProfit: "+12.4%",
  },

  languages: ["Bahasa Melayu", "English", "Bahasa Indonesia", "தமிழ் (Tamil)", "中文 (Chinese)"],
};
