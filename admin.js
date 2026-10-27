import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, deleteDoc, doc, orderBy, getDocs, writeBatch, updateDoc, limit } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_EMAIL } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginView=document.getElementById("loginView"), dashboard=document.getElementById("dashboardView");
const loginForm=document.getElementById("loginForm"), loginError=document.getElementById("loginError");

function todayKey(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date())}
function todayText(){return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Dhaka",day:"2-digit",month:"long",year:"numeric"}).format(new Date())}
document.getElementById("adminDate").textContent=todayText();

onAuthStateChanged(auth,user=>{
  if(user && user.email===ADMIN_EMAIL){
    loginView.classList.add("hidden"); dashboard.classList.remove("hidden"); loadRiders(); loadIds(); loadComments();
  }else{
    dashboard.classList.add("hidden"); loginView.classList.remove("hidden");
  }
});

loginForm.onsubmit=async e=>{
  e.preventDefault(); loginError.textContent="";
  try{
    const cred=await signInWithEmailAndPassword(auth,document.getElementById("email").value.trim(),document.getElementById("password").value);
    if(cred.user.email!==ADMIN_EMAIL){await signOut(auth);throw new Error("This account is not the configured admin.");}
  }catch(err){loginError.textContent=err.message.replace("Firebase: ","").replace(/\(auth.*\)\.?/,"");}
};
document.getElementById("logoutBtn").onclick=()=>signOut(auth);

let riders=[];
function loadRiders(){
  onSnapshot(query(collection(db,"riders"),orderBy("name")),snap=>{
    riders=snap.docs.map(d=>({id:d.id,...d.data()}));
    document.getElementById("riderSelect").innerHTML='<option value="">Select rider</option>'+
      riders.filter(r=>r.active!==false).map(r=>`<option value="${r.id}">${esc(r.name)}</option>`).join("");
    document.getElementById("riderList").innerHTML=riders.map(r=>`
      <div class="admin-item">
        <div><b>${esc(r.name)}</b><small>${r.active===false?"Inactive":"Active"}</small></div>
        <button class="danger-btn" data-del-rider="${r.id}">Remove</button>
      </div>`).join("") || '<div class="empty">No riders yet.</div>';
    document.querySelectorAll("[data-del-rider]").forEach(b=>b.onclick=async()=>{
      if(confirm("Remove this rider?")) await deleteDoc(doc(db,"riders",b.dataset.delRider));
    });
  });
}
document.getElementById("riderForm").onsubmit=async e=>{
  e.preventDefault();
  const name=document.getElementById("riderName").value.trim();
  await addDoc(collection(db,"riders"),{name,active:true,createdAt:Date.now()});
  e.target.reset(); document.getElementById("riderMessage").textContent="Rider added successfully.";
};

function loadIds(){
  onSnapshot(query(collection(db,"dailyIds"),where("dateKey","==",todayKey())),snap=>{
    const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    document.getElementById("adminIds").innerHTML=rows.map(r=>`
      <div class="admin-item">
        <div><b>${esc(r.code)}</b><small>${esc(r.riderName || "Unassigned")}</small></div>
        <button class="danger-btn" data-del-id="${r.id}">Delete</button>
      </div>`).join("") || '<div class="empty">No IDs added today.</div>';
    document.querySelectorAll("[data-del-id]").forEach(b=>b.onclick=async()=>{
      if(confirm("Delete this ID from today's list?")) await deleteDoc(doc(db,"dailyIds",b.dataset.delId));
    });
  });
}
document.getElementById("idForm").onsubmit=async e=>{
  e.preventDefault();

  const message=document.getElementById("idMessage");
  const raw=document.getElementById("dailyId").value;
  const rider=riders.find(r=>r.id===document.getElementById("riderSelect").value);

  if(!rider){
    message.textContent="Please select a rider.";
    return;
  }

  // Google Sheets copy/paste:
  // one ID per row. Hidden spaces/tabs around an ID are removed automatically.
  const codes=[...new Set(
    raw
      .split(/\r?\n/)
      .map(line=>line.replace(/\s+/g,"").trim())
      .filter(Boolean)
  )];

  if(!codes.length){
    message.textContent="Please paste at least one ID.";
    return;
  }

  message.textContent="Adding "+codes.length+" ID(s)...";

  try{
    // Get today's IDs once so existing IDs are skipped.
    const existingSnap=await getDocs(
      query(collection(db,"dailyIds"),where("dateKey","==",todayKey()))
    );

    const existingCodes=new Set(
      existingSnap.docs.map(d=>String(d.data().code||"").replace(/\s+/g,"").trim())
    );

    const newCodes=codes.filter(code=>!existingCodes.has(code));

    if(!newCodes.length){
      message.textContent="All pasted IDs already exist today.";
      return;
    }

    // Firestore allows up to 500 writes per batch.
    // This automatically handles more than 500 pasted IDs too.
    for(let i=0;i<newCodes.length;i+=500){
      const chunk=newCodes.slice(i,i+500);
      const batch=writeBatch(db);

      chunk.forEach(code=>{
        const ref=doc(collection(db,"dailyIds"));
        batch.set(ref,{
          code,
          riderId:rider.id,
          riderName:rider.name,
          dateKey:todayKey(),
          createdAt:Date.now()
        });
      });

      await batch.commit();
    }

    e.target.reset();

    const skipped=codes.length-newCodes.length;
    message.textContent=skipped
      ? newCodes.length+" IDs added successfully. "+skipped+" duplicate ID(s) skipped."
      : newCodes.length+" IDs added successfully.";

  }catch(err){
    console.error("Bulk ID import error:",err);
    message.textContent="Could not add IDs: "+(err.code || err.message || "Unknown error");
  }
};
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}


async function loadComments() {
  const box = document.getElementById("adminComments");
  if (!box) return;
  box.textContent = "Loading comments…";
  try {
    const snap = await getDocs(query(collection(db, "comments"), orderBy("createdAt", "desc"), limit(200)));
    if (snap.empty) { box.textContent = "No comments submitted yet."; return; }
    box.replaceChildren();
    snap.docs.forEach(d => {
      const c = d.data();
      const card = document.createElement("article");
      card.className = "admin-item comment-admin-item";
      const title = document.createElement("strong");
      title.textContent = c.name || "Visitor";
      const status = document.createElement("span");
      status.className = "comment-status-badge status-" + String(c.status || "pending");
      status.textContent = String(c.status || "pending");
      const body = document.createElement("p");
      body.className = "comment-body";
      body.textContent = c.text || "";
      const date = document.createElement("small");
      date.className = "comment-admin-date";
      date.textContent = c.createdAt && c.createdAt.toDate ? c.createdAt.toDate().toLocaleString("en-BD", {timeZone:"Asia/Dhaka"}) : "Just now";
      const actions = document.createElement("div");
      actions.className = "admin-item-actions";
      if (!c.parentId) actions.appendChild(makeCommentButton("↩ Admin Reply", async () => {
        const replyText = prompt("Write an official DRQR admin reply (max 1000 characters):");
        if (!replyText || replyText.trim().length < 2) return;
        if (replyText.trim().length > 1000) { alert("Reply must be 1000 characters or fewer."); return; }
        const user = auth.currentUser;
        if (!user || user.email !== ADMIN_EMAIL) { alert("Only the configured admin can send an official reply."); return; }
        await addDoc(collection(db, "comments"), {
          name: "DRQR Admin",
          text: replyText.trim(),
          uid: user.uid,
          parentId: d.id,
          isAdmin: true,
          status: "pending",
          createdAt: new Date()
        });
        alert("Admin reply submitted. Approve it from the moderation list to publish it.");
        await loadComments();
      }));
      if (c.status !== "approved") actions.appendChild(makeCommentButton("Approve", async () => { await updateDoc(doc(db, "comments", d.id), {status:"approved"}); await loadComments(); }));
      if (c.status !== "hidden") actions.appendChild(makeCommentButton("Hide", async () => { await updateDoc(doc(db, "comments", d.id), {status:"hidden"}); await loadComments(); }));
      actions.appendChild(makeCommentButton("Delete", async () => {
        if (!confirm("Delete this comment permanently?")) return;
        await deleteDoc(doc(db, "comments", d.id)); await loadComments();
      }));
      const heading = document.createElement("div");
      heading.className = "comment-meta";
      heading.append(title, status);
      card.append(heading, date, body, actions);
      box.appendChild(card);
    });
  } catch (err) {
    console.error("Could not load comments:", err);
    box.textContent = "Could not load comments: " + (err.code || err.message || "Unknown error");
  }
}
function makeCommentButton(label, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action(); }
    catch (err) { console.error(err); alert("Action failed: " + (err.code || err.message || "Unknown error")); button.disabled = false; }
  });
  return button;
}
