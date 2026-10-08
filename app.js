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
    timeZone: "Asia/Dhaka", year:"numeric", month:"2-digit", day:"2-digit"
  }).format(new Date());
}
function bdDateText() {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone:"Asia/Dhaka", day:"2-digit", month:"long", year:"numeric"
  }).format(new Date());
}
const today = bdDateKey();
todayLabel.textContent = bdDateText();

let records = [];
const q = query(collection(db, "dailyIds"), where("dateKey", "==", today));
onSnapshot(q, snap => {
  records = snap.docs.map(d => ({id:d.id, ...d.data()}));
  render();
}, err => {
  results.innerHTML = `<div class="empty">Could not load today's IDs. Please check the Firebase setup.</div>`;
  console.error(err);
});

function render() {
  const term = searchInput.value.trim().toLowerCase();
  const found = !term ? records : records.filter(x =>
    String(x.code).toLowerCase().includes(term) ||
    String(x.riderName || "").toLowerCase().includes(term) ||
    String(x.employeeId || "").toLowerCase().includes(term)
  );
  if (!found.length) {
    results.innerHTML = `<div class="empty">${term ? "No matching ID found." : "No IDs available for today."}</div>`;
    return;
  }
  results.innerHTML = found.map((r,i) => `
    <article class="result-card">
      <div>
        <div class="eyebrow">DAILY ID</div>
        <div class="id">${escapeHtml(r.code)}</div>
        <div class="meta">Rider: <b>${escapeHtml(r.riderName || "Unassigned")}</b></div>
        <div class="meta">Employee ID: <b>${escapeHtml(r.employeeId || "—")}</b></div>
        <div class="card-actions">
          <button data-copy="${escapeAttr(r.code)}">Copy ID</button>
          <button data-qr="${i}">Zoom QR</button>
        </div>
      </div>
      <div class="qr-box" id="qr-${i}" data-zoom="${i}"></div>
    </article>
  `).join("");

  found.forEach((r,i) => {
    new QRCode(document.getElementById(`qr-${i}`), {text:r.code, width:130, height:130, correctLevel:QRCode.CorrectLevel.M});
  });
  document.querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => {
    await navigator.clipboard.writeText(b.dataset.copy);
    b.textContent = "Copied ✓"; setTimeout(()=>b.textContent="Copy ID",1200);
  });
  document.querySelectorAll("[data-qr]").forEach(b => b.onclick = () => openQr(found[Number(b.dataset.qr)].code));
  document.querySelectorAll("[data-zoom]").forEach(b => b.onclick = () => openQr(found[Number(b.dataset.zoom)].code));
}
searchInput.addEventListener("input", render);
document.getElementById("clearBtn").onclick = () => {searchInput.value=""; render(); searchInput.focus();};

document.getElementById("generateBtn").onclick = () => {
  const code = quickId.value.trim();
  if (!code) return;
  openQr(code);
};

let scale = 1;
function openQr(code) {
  scale = 1;
  document.getElementById("modalText").textContent = code;
  const box = document.getElementById("modalQr");
  box.innerHTML = "";
  new QRCode(box,{text:code,width:280,height:280,correctLevel:QRCode.CorrectLevel.H});
  box.style.transform = "scale(1)";
  document.getElementById("qrModal").classList.remove("hidden");
}
document.getElementById("closeModal").onclick=()=>document.getElementById("qrModal").classList.add("hidden");
document.getElementById("zoomIn").onclick=()=>{scale=Math.min(1.8,scale+.15);document.getElementById("modalQr").style.transform=`scale(${scale})`};
document.getElementById("zoomOut").onclick=()=>{scale=Math.max(.55,scale-.15);document.getElementById("modalQr").style.transform=`scale(${scale})`};

function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
function escapeAttr(v){return escapeHtml(v).replace(/`/g,"&#096;");}
