import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, getCountFromServer } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const todayLabel = document.getElementById("todayLabel");
const quickId = document.getElementById("quickId");
const totalSubmittedEl = document.getElementById("totalSubmitted");
const totalGeneratedEl = document.getElementById("totalGenerated");

// Load lifetime statistics with an aggregate count instead of streaming every document.
getCountFromServer(collection(db, "dailyIds")).then(snapshot => {
  const formatted = snapshot.data().count.toLocaleString("en-US");
  if (totalSubmittedEl) totalSubmittedEl.textContent = formatted;
  if (totalGeneratedEl) totalGeneratedEl.textContent = formatted;
}).catch(err => {
  console.error("Could not load lifetime stats:", err);
  if (totalSubmittedEl) totalSubmittedEl.textContent = "—";
  if (totalGeneratedEl) totalGeneratedEl.textContent = "—";
});

function bdDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
function bdDateText() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka", day: "2-digit", month: "long", year: "numeric"
  }).format(new Date());
}
const today = bdDateKey();
todayLabel.textContent = bdDateText();

let records = [];
const cacheKey = "drqr-today-ids-" + today;

// Render the last successful result immediately while Firebase reconnects.
try {
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (Array.isArray(parsed)) {
      records = parsed;
      renderRecords();
    }
  }
} catch (err) {
  console.warn("Could not read cached rider IDs:", err);
}
if (!records.length) {
  results.innerHTML = '<div class="empty">Loading today\'s IDs…</div>';
}

const q = query(collection(db, "dailyIds"), where("dateKey", "==", today));
onSnapshot(q, snap => {
  const freshRecords = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const changed = JSON.stringify(records) !== JSON.stringify(freshRecords);
  records = freshRecords;
  try { localStorage.setItem(cacheKey, JSON.stringify(records)); } catch (err) {
    console.warn("Could not cache rider IDs:", err);
  }
  // Avoid rebuilding every QR code if the live result is identical to the cache.
  if (changed || !results.querySelector(".result-card")) renderRecords();
}, err => {
  console.error("Could not load today's IDs:", err);
  if (!records.length) {
    results.innerHTML = '<div class="empty">Could not load today\'s IDs. Please check your connection and try again.</div>';
  }
});

// Build cards and QR codes only when Firebase data changes, not on every keystroke.
function renderRecords() {
  if (!records.length) {
    results.innerHTML = '<div class="empty">No IDs available for today.</div>';
    return;
  }

  results.innerHTML = records.map((r, i) => {
    const code = String(r.code ?? "");
    const name = String(r.riderName || "Unassigned");
    return `
      <article class="result-card" data-search="${escapeAttr((code + " " + name).toLowerCase())}">
        <div>
          <div class="eyebrow">DAILY ID</div>
          <div class="id">${escapeHtml(code)}</div>
          <div class="meta">Rider: <b>${escapeHtml(name)}</b></div>
          <div class="card-actions">
            <button data-copy="${escapeAttr(code)}">Copy ID</button>
            <button data-qr-code="${escapeAttr(code)}">Zoom QR</button>
          </div>
        </div>
        <div class="qr-box" id="qr-${i}" data-zoom-code="${escapeAttr(code)}"></div>
      </article>
    `;
  }).join("") + '<div class="empty hidden" id="filterEmpty">No matching ID found.</div>';

  applyFilter();

  // Generate QR codes during browser idle time in small batches so the search
  // field and mobile keyboard remain responsive while the page is opening.
  scheduleQrRendering(records.map((r, i) => ({ code: String(r.code ?? ""), index: i })));
}

let qrRenderQueue = [];
let qrRenderScheduled = false;

function scheduleQrRendering(items) {
  qrRenderQueue = items;
  if (qrRenderScheduled) return;
  qrRenderScheduled = true;

  const runBatch = deadline => {
    let processed = 0;
    while (qrRenderQueue.length && processed < 2 &&
           (!deadline || deadline.timeRemaining() > 5 || processed === 0)) {
      const item = qrRenderQueue.shift();
      const box = document.getElementById(`qr-${item.index}`);
      if (box && !box.hasChildNodes() && typeof QRCode !== "undefined") {
        new QRCode(box, {
          text: item.code,
          width: 130,
          height: 130,
          correctLevel: QRCode.CorrectLevel.M
        });
      }
      processed++;
    }

    if (qrRenderQueue.length) {
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(runBatch, { timeout: 250 });
      } else {
        window.setTimeout(() => runBatch(null), 30);
      }
    } else {
      qrRenderScheduled = false;
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(runBatch, { timeout: 250 });
  } else {
    window.setTimeout(() => runBatch(null), 30);
  }
}

function applyFilter() {
  const term = searchInput.value.trim().toLowerCase();
  const cards = results.querySelectorAll(".result-card");
  let visibleCount = 0;

  cards.forEach(card => {
    const matches = !term || (card.dataset.search || "").includes(term);
    card.classList.toggle("hidden", !matches);
    if (matches) visibleCount++;
  });

  const empty = document.getElementById("filterEmpty");
  if (empty) {
    empty.classList.toggle("hidden", visibleCount > 0);
    empty.textContent = term ? "No matching ID found." : "No IDs available for today.";
  }
}

searchInput.addEventListener("input", applyFilter);
document.getElementById("clearBtn").onclick = () => {
  searchInput.value = "";
  applyFilter();
  searchInput.focus();
};

results.addEventListener("click", async event => {
  const copyButton = event.target.closest("[data-copy]");
  if (copyButton) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy);
      copyButton.textContent = "Copied ✓";
      setTimeout(() => { copyButton.textContent = "Copy ID"; }, 1200);
    } catch (err) {
      console.error("Could not copy ID:", err);
    }
    return;
  }

  const qrButton = event.target.closest("[data-qr-code]");
  if (qrButton) {
    openQr(qrButton.dataset.qrCode);
    return;
  }

  const qrBox = event.target.closest("[data-zoom-code]");
  if (qrBox) openQr(qrBox.dataset.zoomCode);
});



// Public custom QR flow: first reveal color and style cards, then render the chosen design.
const qrCustomize = document.getElementById("qrCustomize");
const createCustomQrBtn = document.getElementById("createCustomQrBtn");
const downloadCustomQr = document.getElementById("downloadCustomQr");
let selectedQrColor = "default";
let selectedQrStyle = "square";
let currentCustomQr = null;

const qrPalettes = {
  default: { dark: "#111111", light: "#ffffff" },
  ocean: { dark: "#087eae", light: "#e8fbff" },
  forest: { dark: "#176b3a", light: "#effff3" },
  sunset: { dark: "#c84c20", light: "#fff4e8" },
  violet: { dark: "#6535b8", light: "#f7f0ff" },
  ruby: { dark: "#b51f4b", light: "#fff0f3" }
};

function selectQrOption(groupSelector, selectedButton, datasetKey) {
  document.querySelectorAll(groupSelector).forEach(button => {
    const active = button === selectedButton;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (datasetKey === "color") selectedQrColor = selectedButton.dataset.color;
  else selectedQrStyle = selectedButton.dataset.style;
}

document.querySelectorAll(".color-choice").forEach(button => {
  button.addEventListener("click", () => selectQrOption(".color-choice", button, "color"));
});
document.querySelectorAll(".style-choice").forEach(button => {
  button.addEventListener("click", () => selectQrOption(".style-choice", button, "style"));
});

const qrGeneratorArea = document.querySelector(".public-import");
function hideQrCustomize() {
  if (qrCustomize) qrCustomize.classList.add("hidden");
}
document.addEventListener("click", event => {
  if (qrCustomize && !qrCustomize.classList.contains("hidden") &&
      qrGeneratorArea && !qrGeneratorArea.contains(event.target)) {
    hideQrCustomize();
  }
});
quickId.addEventListener("input", () => {
  if (!quickId.value.trim()) hideQrCustomize();
});

document.getElementById("generateBtn").onclick = () => {
  const code = quickId.value.trim();
  if (!code) {
    quickId.focus();
    quickId.setCustomValidity("Please enter an ID first.");
    quickId.reportValidity();
    quickId.addEventListener("input", () => quickId.setCustomValidity(""), { once: true });
    return;
  }
  qrCustomize.classList.remove("hidden");
  qrCustomize.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

createCustomQrBtn.addEventListener("click", () => {
  const code = quickId.value.trim();
  if (!code) { quickId.focus(); return; }
  if (typeof QRCodeStyling === "undefined") {
    alert("QR style library could not load. Please check your internet connection and try again.");
    return;
  }
  const palette = qrPalettes[selectedQrColor] || qrPalettes.default;
  const dotsType = selectedQrStyle === "square" ? "square" :
    selectedQrStyle === "dots" ? "dots" :
    selectedQrStyle === "rounded" ? "rounded" :
    selectedQrStyle === "classy" ? "classy" :
    selectedQrStyle === "classy-rounded" ? "classy-rounded" : "extra-rounded";
  const box = document.getElementById("modalQr");
  box.innerHTML = "";
  currentCustomQr = new QRCodeStyling({
    width: 280, height: 280, type: "canvas", data: code,
    margin: 8,
    qrOptions: { errorCorrectionLevel: "H" },
    dotsOptions: { color: palette.dark, type: dotsType },
    backgroundOptions: { color: palette.light },
    cornersSquareOptions: { color: palette.dark, type: selectedQrStyle === "dots" ? "dot" : (selectedQrStyle === "extra-rounded" ? "extra-rounded" : "square") },
    cornersDotOptions: { color: palette.dark, type: selectedQrStyle === "dots" ? "dot" : "square" }
  });
  currentCustomQr.append(box);
  document.getElementById("modalText").textContent = code;
  box.style.transform = "scale(1)";
  scale = 1;
  downloadCustomQr.classList.remove("hidden");
  document.getElementById("qrModal").classList.remove("hidden");
  hideQrCustomize();
});

downloadCustomQr.addEventListener("click", () => {
  if (currentCustomQr) currentCustomQr.download({ name: "DRQR-" + (quickId.value.trim().replace(/[^a-z0-9_-]/gi, "-") || "custom"), extension: "png" });
});


let scale = 1;
function openQr(code) {
  scale = 1;
  currentCustomQr = null;
  if (downloadCustomQr) downloadCustomQr.classList.add("hidden");
  document.getElementById("modalText").textContent = code;
  const box = document.getElementById("modalQr");
  box.innerHTML = "";
  new QRCode(box, {
    text: code,
    width: 280,
    height: 280,
    correctLevel: QRCode.CorrectLevel.H
  });
  box.style.transform = "scale(1)";
  document.getElementById("qrModal").classList.remove("hidden");
}
document.getElementById("closeModal").onclick = () => document.getElementById("qrModal").classList.add("hidden");
document.getElementById("zoomIn").onclick = () => {
  scale = Math.min(1.8, scale + 0.15);
  document.getElementById("modalQr").style.transform = `scale(${scale})`;
};
document.getElementById("zoomOut").onclick = () => {
  scale = Math.max(0.55, scale - 0.15);
  document.getElementById("modalQr").style.transform = `scale(${scale})`;
};

function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}
function escapeAttr(v) {
  return escapeHtml(v).replace(/`/g, "&#096;");
}


// Accessible light/dark theme toggle. Preference is stored only in this browser.
const themeToggle = document.getElementById("themeToggle");
function applyTheme(isLight) {
  document.body.classList.toggle("light-mode", isLight);
  if (themeToggle) {
    themeToggle.textContent = isLight ? "🌙 Black Mode" : "☀️ White Mode";
    themeToggle.setAttribute("aria-pressed", String(isLight));
    themeToggle.setAttribute("aria-label", isLight ? "Switch to black mode" : "Switch to white mode");
  }
}
let savedTheme = null;
try { savedTheme = localStorage.getItem("drqr-theme"); } catch (_) {}
applyTheme(savedTheme === "light");
if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isLight = !document.body.classList.contains("light-mode");
    applyTheme(isLight);
    try { localStorage.setItem("drqr-theme", isLight ? "light" : "dark"); } catch (_) {}
  });
}
