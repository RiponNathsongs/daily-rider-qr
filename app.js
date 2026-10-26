import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getFirestore, collection, query, where, onSnapshot, getCountFromServer, addDoc, serverTimestamp, doc, setDoc, deleteDoc, getDocs, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
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


// Community comments and moderation-aware replies.
const commentAuth = getAuth(app);
const commentForm = document.getElementById("commentForm");
const commentName = document.getElementById("commentName");
const commentText = document.getElementById("commentText");
const commentStatus = document.getElementById("commentStatus");
const commentsList = document.getElementById("commentsList");
const commentsCount = document.getElementById("commentsCount");
let approvedComments = [];
let commentsUnsubscribe = null;
const commentLikeState = new Map();
async function ensureCommentUser() {
  if (!commentAuth.currentUser) await signInAnonymously(commentAuth);
  return commentAuth.currentUser;
}
function commentDate(value) {
  if (!value) return "Just now";
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "Recently" : new Intl.DateTimeFormat("en-BD", {dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Dhaka"}).format(date);
}
function renderComments() {
  if (!commentsList) return;
  commentsCount.textContent = approvedComments.length + (approvedComments.length === 1 ? " comment" : " comments");
  if (!approvedComments.length) { commentsList.innerHTML = '<div class="empty">No approved comments yet. Be the first to share feedback!</div>'; return; }
  const parents = approvedComments.filter(c => !c.parentId);
  const replies = approvedComments.filter(c => c.parentId);
  commentsList.innerHTML = parents.map(c => {
    const childReplies = replies.filter(r => r.parentId === c.id);
    const liked = commentLikeState.get(c.id) || false;
    return `<article class="comment-card"><div class="comment-meta"><strong>${escapeHtml(c.name || "Visitor")}${c.isAdmin ? '<span class="admin-badge" title="Official DRQR administrator">👑 Admin</span>' : ""}</strong><time>${escapeHtml(commentDate(c.createdAt))}</time></div>
      <p class="comment-body">${escapeHtml(c.text || "")}</p><div class="comment-actions"><button type="button" class="comment-like ${liked ? "is-liked" : ""}" data-like-comment="${escapeAttr(c.id)}" aria-pressed="${liked}">♥ <span>${c.likeCount || 0}</span> Like</button><button type="button" class="comment-reply" data-reply-comment="${escapeAttr(c.id)}">↩ Reply</button></div>
      ${childReplies.map(r => `<div class="comment-reply-card"><div class="comment-meta"><strong>${escapeHtml(r.name || "Visitor")}${r.isAdmin ? '<span class="admin-badge" title="Official DRQR administrator">👑 Admin</span>' : ""}</strong><time>${escapeHtml(commentDate(r.createdAt))}</time></div><p class="comment-body">${escapeHtml(r.text || "")}</p></div>`).join("")}</article>`;
  }).join("");
  commentsList.querySelectorAll("[data-like-comment]").forEach(btn => btn.addEventListener("click", () => toggleCommentLike(btn.dataset.likeComment)));
  commentsList.querySelectorAll("[data-reply-comment]").forEach(btn => btn.addEventListener("click", () => replyToComment(btn.dataset.replyComment)));
}
async function loadCommentLikes() {
  if (!commentAuth.currentUser) return;
  await Promise.all(approvedComments.map(async c => {
    try {
      const likesRef = collection(db, "comments", c.id, "likes");
      const count = await getCountFromServer(likesRef);
      c.likeCount = count.data().count;
      const mine = await getDocs(query(likesRef, where("uid", "==", commentAuth.currentUser.uid), limit(1)));
      commentLikeState.set(c.id, !mine.empty);
    } catch (err) { console.warn("Could not load comment likes", err); }
  }));
  renderComments();
}
function subscribeToComments() {
  if (!commentsList) return;
  if (commentsUnsubscribe) commentsUnsubscribe();
  const approvedQuery = query(collection(db, "comments"), where("status", "==", "approved"), limit(100));
  commentsUnsubscribe = onSnapshot(approvedQuery, snap => {
    approvedComments = snap.docs.map(d => ({id:d.id,...d.data(),likeCount:0}));
    approvedComments.sort((a, b) => {
      const aTime = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
      const bTime = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
      return bTime - aTime;
    });
    renderComments(); loadCommentLikes();
  }, err => {
    console.error("Comments could not be loaded:", err);
    commentsList.innerHTML = '<div class="empty">Comments could not load right now. Please refresh the page later.</div>';
  });
}
const COMMENT_COOLDOWN_MS = 30 * 1000;
const COMMENT_LAST_POST_KEY = "drqr-comment-last-post";
const COMMENT_LAST_TEXT_KEY = "drqr-comment-last-text";

function getCommentCooldownRemaining() {
  try {
    const last = Number(localStorage.getItem(COMMENT_LAST_POST_KEY) || 0);
    return Math.max(0, COMMENT_COOLDOWN_MS - (Date.now() - last));
  } catch (_) { return 0; }
}
function formatCooldown(ms) {
  return Math.ceil(ms / 1000);
}
if (commentForm) {
  ensureCommentUser().then(subscribeToComments).catch(err => {
    console.error("Anonymous sign-in failed:", err);
    commentStatus.textContent = "Comment service is unavailable. Please refresh and try again.";
  });
  commentForm.addEventListener("submit", async e => {
    e.preventDefault();
    const name = commentName.value.trim(), body = commentText.value.trim();
    if (name.length < 2 || body.length < 2) { commentStatus.textContent = "Please enter your name and a comment."; return; }
    if (name.length > 40 || body.length > 1000) { commentStatus.textContent = "Name must be 2–40 characters and comment must be no more than 1000 characters."; return; }
    // Basic client-side spam checks. Firestore rules/admin moderation remain important.
    const linkCount = (body.match(/https?:\/\/|www\./gi) || []).length;
    if (linkCount > 1) { commentStatus.textContent = "For safety, comments may contain at most one link."; return; }
    const normalizedBody = body.toLowerCase().replace(/\s+/g, " ").trim();
    try {
      if (localStorage.getItem(COMMENT_LAST_TEXT_KEY) === normalizedBody) {
        commentStatus.textContent = "You already submitted this exact comment recently. Please write something new.";
        return;
      }
    } catch (_) {}
    const remaining = getCommentCooldownRemaining();
    if (remaining > 0) {
      commentStatus.textContent = "Please wait " + formatCooldown(remaining) + " seconds before posting another comment.";
      return;
    }
    const button = document.getElementById("submitComment"); button.disabled = true;
    commentStatus.textContent = "Posting for admin review…";
    try {
      const user = await ensureCommentUser();
      await addDoc(collection(db,"comments"),{name,text:body,uid:user.uid,parentId:null,status:"pending",createdAt:serverTimestamp()});
      try {
        localStorage.setItem(COMMENT_LAST_POST_KEY, String(Date.now()));
        localStorage.setItem(COMMENT_LAST_TEXT_KEY, normalizedBody);
      } catch (_) {}
      commentText.value = ""; commentStatus.textContent = "Submitted! Your comment will appear after admin approval.";
    } catch(err) { console.error("Could not submit comment:",err); commentStatus.textContent = "Could not post comment. Please check connection and try again."; }
    finally { button.disabled = false; }
  });
}
async function replyToComment(parentId) {
  const body = prompt("Write your reply (it will appear after admin approval):");
  if (!body || body.trim().length < 2) return;
  const name = (commentName.value.trim() || prompt("Enter your name:") || "").trim();
  if (name.length < 2 || name.length > 40) { alert("Please enter a name between 2 and 40 characters in the comment form first."); return; }
  try {
    const user = await ensureCommentUser();
    await addDoc(collection(db,"comments"),{name,text:body.trim().slice(0,1000),uid:user.uid,parentId,status:"pending",createdAt:serverTimestamp()});
    commentStatus.textContent = "Reply submitted for admin approval.";
  } catch(err) { console.error(err); alert("Could not submit reply. Please try again."); }
}
async function toggleCommentLike(commentId) {
  try {
    const user = await ensureCommentUser(), likeRef = doc(db,"comments",commentId,"likes",user.uid);
    const alreadyLiked = commentLikeState.get(commentId) || false;
    if (alreadyLiked) await deleteDoc(likeRef); else await setDoc(likeRef,{uid:user.uid,createdAt:serverTimestamp()});
    commentLikeState.set(commentId,!alreadyLiked);
    const item = approvedComments.find(c => c.id === commentId);
    if (item) item.likeCount = Math.max(0,(item.likeCount||0)+(alreadyLiked?-1:1));
    renderComments();
  } catch(err) { console.error(err); alert("Could not update like. Please try again."); }
}
