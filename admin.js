import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore, collection, addDoc, query, where, onSnapshot, deleteDoc, doc, orderBy } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
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
    loginView.classList.add("hidden"); dashboard.classList.remove("hidden"); loadRiders(); loadIds();
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
      riders.filter(r=>r.active!==false).map(r=>`<option value="${r.id}">${esc(r.name)} — ${esc(r.employeeId)}</option>`).join("");
    document.getElementById("riderList").innerHTML=riders.map(r=>`
      <div class="admin-item">
        <div><b>${esc(r.name)}</b><small>${esc(r.employeeId)} • ${r.active===false?"Inactive":"Active"}</small></div>
        <button class="danger-btn" data-del-rider="${r.id}">Remove</button>
      </div>`).join("") || '<div class="empty">No riders yet.</div>';
    document.querySelectorAll("[data-del-rider]").forEach(b=>b.onclick=async()=>{
      if(confirm("Remove this rider?")) await deleteDoc(doc(db,"riders",b.dataset.delRider));
    });
  });
}
document.getElementById("riderForm").onsubmit=async e=>{
  e.preventDefault();
  const employeeId=document.getElementById("employeeId").value.trim();
  const name=document.getElementById("riderName").value.trim();
  await addDoc(collection(db,"riders"),{employeeId,name,active:true,createdAt:Date.now()});
  e.target.reset(); document.getElementById("riderMessage").textContent="Rider added successfully.";
};

function loadIds(){
  onSnapshot(query(collection(db,"dailyIds"),where("dateKey","==",todayKey())),snap=>{
    const rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    document.getElementById("adminIds").innerHTML=rows.map(r=>`
      <div class="admin-item">
        <div><b>${esc(r.code)}</b><small>${esc(r.riderName)} • ${esc(r.employeeId)}</small></div>
        <button class="danger-btn" data-del-id="${r.id}">Delete</button>
      </div>`).join("") || '<div class="empty">No IDs added today.</div>';
    document.querySelectorAll("[data-del-id]").forEach(b=>b.onclick=async()=>{
      if(confirm("Delete this ID from today's list?")) await deleteDoc(doc(db,"dailyIds",b.dataset.delId));
    });
  });
}
document.getElementById("idForm").onsubmit=async e=>{
  e.preventDefault();
  const code=document.getElementById("dailyId").value.trim();
  const rider=riders.find(r=>r.id===document.getElementById("riderSelect").value);
  if(!rider) return;
  const exists=await import("https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js").then(async m=>{
    const s=await m.getDocs(query(collection(db,"dailyIds"),where("dateKey","==",todayKey()),where("code","==",code)));
    return !s.empty;
  });
  if(exists){document.getElementById("idMessage").textContent="This ID already exists today.";return;}
  await addDoc(collection(db,"dailyIds"),{
    code,riderId:rider.id,riderName:rider.name,employeeId:rider.employeeId,
    dateKey:todayKey(),createdAt:Date.now()
  });
  e.target.reset(); document.getElementById("idMessage").textContent="ID added successfully.";
};
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
