import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const searchInput = document.getElementById("searchInput");
const results = document.getElementById("results");
const todayLabel = document.getElementById("todayLabel");
const quickId = document.getElementById("quickId");

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
const q = query(collection(db, "dailyIds"), where("dateKey", "==", today));

onSnapshot(q, snap => {
  records = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderRecords();
}, err => {
  results.innerHTML = '<div class="empty">Could not load today\'s IDs. Please check the Firebase setup.</div>';
  console.error(err);
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

  records.forEach((r, i) => {
    const box = document.getElementById(`qr-${i}`);
    if (box && typeof QRCode !== "undefined") {
      new QRCode(box, {
        text: String(r.code ?? ""),
        width: 130,
        height: 130,
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  });

  applyFilter();
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

document.getElementById("generateBtn").onclick = () => {
  const code = quickId.value.trim();
  if (code) openQr(code);
};

let scale = 1;
function openQr(code) {
  scale = 1;
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
