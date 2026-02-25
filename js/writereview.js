/* =========================================================
   writereview.js
   - Loads restaurants from ./data/restaurants.json
   - If ?id=xxx present, locks restaurant selection
   - Accepts photo uploads, resizes/compresses for storage
   - Submits into a Pending moderation queue (localStorage)
   - Optional Mod Mode (?mod=1) to approve/reject locally
   ========================================================= */

function $(sel, root = document){ return root.querySelector(sel); }

const DATA_URL = "../data/restaurants.json";          // writereview.html lives in /assets
const PENDING_KEY = "bagelbites_pending_reviews_v1";  // all pending, all restaurants
const MOD_FLAG_KEY = "bagelbites_mod_mode";           // "1" enables moderator panel

function escapeHtml(str){
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getQuery(){
  const p = new URLSearchParams(location.search);
  return {
    id: p.get("id") || "",
    mod: p.get("mod") || ""
  };
}

function reviewStorageKey(restaurantId){
  return `bagelbites_reviews_${restaurantId}`;
}

function loadJson(url){
  return fetch(url, { cache: "no-store" }).then(async r => {
    if (!r.ok){
      const t = await r.text().catch(() => "");
      throw new Error(`Failed to load ${url} (${r.status}). ${t.slice(0, 120)}`);
    }
    return r.json();
  });
}

function loadPending(){
  try{
    const raw = localStorage.getItem(PENDING_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function savePending(list){
  localStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

function loadApproved(restaurantId){
  try{
    const raw = localStorage.getItem(reviewStorageKey(restaurantId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }catch{
    return [];
  }
}

function saveApproved(restaurantId, list){
  localStorage.setItem(reviewStorageKey(restaurantId), JSON.stringify(list));
}

function uuid(){
  return (crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`);
}

function showNotice(html, kind = "ok"){
  const box = $("#notice");
  box.style.display = "block";
  box.style.borderStyle = "solid";
  box.style.borderColor = kind === "ok" ? "rgba(186,255,58,.35)" : "rgba(255,79,216,.45)";
  box.style.background = kind === "ok" ? "rgba(186,255,58,.08)" : "rgba(255,79,216,.10)";
  box.innerHTML = html;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearNotice(){
  const box = $("#notice");
  box.style.display = "none";
  box.innerHTML = "";
}

/* ---------- Photo handling (resize + compress) ---------- */

const MAX_PHOTOS = 4;
const MAX_DIM = 1400;     // max width/height
const JPEG_QUALITY = 0.82;

async function fileToResizedDataUrl(file){
  // Load into Image
  const dataUrl = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Could not read file"));
    fr.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Could not load image"));
    im.src = dataUrl;
  });

  // Calculate new size
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext("2d", { alpha: false });

  // Draw
  ctx.drawImage(img, 0, 0, nw, nh);

  // Convert to jpeg data url
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

function renderPhotoPreview(dataUrls){
  const wrap = $("#photoPreview");
  wrap.innerHTML = "";

  for (let i = 0; i < dataUrls.length; i++){
    const src = dataUrls[i];
    const card = document.createElement("div");
    card.className = "panel";
    card.style.width = "140px";
    card.style.padding = "10px";
    card.style.borderRadius = "18px";
    card.style.display = "grid";
    card.style.gap = "8px";

    card.innerHTML = `
      <img src="${escapeHtml(src)}" alt="Selected photo ${i+1}" style="width:100%;height:96px;object-fit:cover;border-radius:14px;border:1px solid rgba(255,255,255,.12);" />
      <button type="button" class="pillBtn" data-remove="${i}" style="justify-content:center;">Remove</button>
    `;
    wrap.appendChild(card);
  }

  wrap.querySelectorAll("[data-remove]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove"));
      if (!Number.isFinite(idx)) return;
      window.__photoDataUrls.splice(idx, 1);
      renderPhotoPreview(window.__photoDataUrls);
      $("#photos").value = "";
    });
  });
}

/* ---------- Restaurants select ---------- */

function populateRestaurantSelect(restaurants, selectedId){
  const sel = $("#restaurantSelect");
  sel.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a restaurant…";
  sel.appendChild(opt0);

  for (const r of restaurants){
    const opt = document.createElement("option");
    opt.value = r.id;
    opt.textContent = r.name;
    sel.appendChild(opt);
  }

  if (selectedId){
    sel.value = selectedId;
  }
}

/* ---------- Mod mode ---------- */

function isModMode(){
  return localStorage.getItem(MOD_FLAG_KEY) === "1";
}

function setModMode(on){
  localStorage.setItem(MOD_FLAG_KEY, on ? "1" : "0");
}

function makeAvatarSeed(name){
  // Simple deterministic-ish placeholder via dicebear (no API key)
  const seed = encodeURIComponent((name || "bagelhole").trim().toLowerCase());
  return `https://api.dicebear.com/9.x/thumbs/svg?seed=${seed}`;
}

function renderPendingList(restaurants){
  const panel = $("#modPanel");
  if (!isModMode()){
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";

  const pending = loadPending().slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
  const list = $("#pendingList");
  list.innerHTML = "";

  if (!pending.length){
    list.innerHTML = `<div class="emptyState">No pending reviews. Peaceful. Suspiciously peaceful.</div>`;
    return;
  }

  const nameById = new Map(restaurants.map(r => [r.id, r.name]));

  for (const rv of pending){
    const photos = (rv.photos || []).slice(0, 6).map(p => `<img src="${escapeHtml(p)}" alt="Pending photo" style="width:92px;height:72px;object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.14);" />`).join("");

    const card = document.createElement("div");
    card.className = "review";
    card.style.gridTemplateColumns = "1fr";
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div>
          <div style="font-weight:900;">${escapeHtml(rv.name || "Anonymous")}</div>
          <div class="muted small">${escapeHtml(nameById.get(rv.restaurantId) || rv.restaurantId)} • ${new Date(rv.createdAt || Date.now()).toLocaleString()}</div>
        </div>
        <div class="pillBtn" style="cursor:default;"><span style="font-weight:900;">${Number(rv.rating || 0).toFixed(1)}</span><span class="muted">/ 5</span></div>
      </div>

      <div style="margin-top:10px;white-space:pre-wrap;color:rgba(255,255,255,.92);">${escapeHtml(rv.text || "")}</div>

      ${photos ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">${photos}</div>` : ""}

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;">
        <button class="btn" type="button" data-approve="${escapeHtml(rv.id)}">Approve</button>
        <button class="pillBtn" type="button" data-reject="${escapeHtml(rv.id)}">Reject</button>
      </div>
    `;
    list.appendChild(card);
  }

  list.querySelectorAll("[data-approve]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-approve");
      approvePending(id, restaurants);
      renderPendingList(restaurants);
    });
  });

  list.querySelectorAll("[data-reject]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-reject");
      rejectPending(id);
      renderPendingList(restaurants);
    });
  });
}

function approvePending(pendingId, restaurants){
  const pending = loadPending();
  const idx = pending.findIndex(r => r.id === pendingId);
  if (idx < 0) return;

  const rv = pending[idx];
  pending.splice(idx, 1);
  savePending(pending);

  // Move to approved storage for that restaurant, in the format restaurant.js expects
  const approved = loadApproved(rv.restaurantId);

  approved.unshift({
    id: uuid(),
    name: rv.name || "Anonymous",
    avatar: makeAvatarSeed(rv.name),
    rating: Number(rv.rating) || 0,
    text: rv.text || "",
    photos: Array.isArray(rv.photos) ? rv.photos : [],
    createdAt: rv.createdAt || Date.now()
  });

  saveApproved(rv.restaurantId, approved);
}

function rejectPending(pendingId){
  const pending = loadPending();
  const out = pending.filter(r => r.id !== pendingId);
  savePending(out);
}

/* ---------- Main ---------- */

window.__restaurants = [];
window.__photoDataUrls = [];

document.addEventListener("DOMContentLoaded", async () => {
  const q = getQuery();

  // Allow ?mod=1 to enable moderator tools quickly
  if (q.mod === "1") setModMode(true);

  // Wire UI bits
 function setRating(val){
  const raw = Number(val);
  const v = Math.max(0, Math.min(5, Number.isFinite(raw) ? raw : 0));
  $("#rating").value = String(v);
  $("#ratingLabel").textContent = v ? v.toFixed(1) : "—";
  renderStars(v);
}

function renderStars(current){
  const wrap = $("#starPicker");
  wrap.innerHTML = "";

  for (let i = 1; i <= 5; i++){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "starBtn";
    btn.setAttribute("aria-label", `${i} stars`);
    btn.dataset.star = String(i);

    // Determine full/half/empty display
    const full = current >= i;
    const half = !full && current >= (i - 0.5);

    if (full) btn.classList.add("is-on");
    if (half) btn.classList.add("is-on", "is-half");

    btn.innerHTML = `<span class="starGlyph" aria-hidden="true">★</span>`;

    // Click: full star
    btn.addEventListener("click", () => setRating(i));

    // Click between stars for half (use pointer position)
    btn.addEventListener("pointerdown", (e) => {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const halfVal = (x < rect.width / 2) ? (i - 0.5) : i;
      setRating(halfVal);
    });

    wrap.appendChild(btn);
  }
}

// init default rating
setRating(Number($("#rating").value) || 0);

  $("#reviewText").addEventListener("input", () => {
    $("#charCount").textContent = `${$("#reviewText").value.length} / 1200`;
  });

  $("#btnClear").addEventListener("click", () => {
    clearNotice();
    $("#displayName").value = "";
setRating(0);
    $("#reviewText").value = "";
    $("#charCount").textContent = "0 / 1200";
    window.__photoDataUrls = [];
    $("#photos").value = "";
    renderPhotoPreview(window.__photoDataUrls);
  });

  // Load restaurants
  try{
    const restaurants = await loadJson(DATA_URL);
    if (!Array.isArray(restaurants)) throw new Error("restaurants.json must be an array");
    window.__restaurants = restaurants;

    populateRestaurantSelect(restaurants, q.id || "");
    if (q.id){
      $("#restaurantSelect").disabled = true;
      $("#lockedHint").style.display = "block";
    }else{
      $("#lockedHint").style.display = "none";
    }

    // Moderator panel
    $("#btnModOff").addEventListener("click", () => {
      setModMode(false);
      $("#modPanel").style.display = "none";
      showNotice("Moderator mode is off.", "ok");
    });

    $("#btnPurgePending").addEventListener("click", () => {
      savePending([]);
      renderPendingList(restaurants);
      showNotice("Pending queue purged.", "ok");
    });

    renderPendingList(restaurants);
  }catch(err){
    showNotice(`<b>Could not load restaurants.</b><br>${escapeHtml(err.message || String(err))}`, "err");
    $("#restaurantSelect").innerHTML = `<option value="">(failed to load restaurants)</option>`;
  }

  // Photo input handling
  $("#photos").addEventListener("change", async (e) => {
    clearNotice();

    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    // Keep within max
    const remainingSlots = Math.max(0, MAX_PHOTOS - window.__photoDataUrls.length);
    const slice = files.slice(0, remainingSlots);

    if (files.length > remainingSlots){
      showNotice(`Only ${MAX_PHOTOS} photos allowed. Extra files ignored.`, "err");
    }

    // Resize/encode each
    for (const f of slice){
      try{
        const url = await fileToResizedDataUrl(f);
        window.__photoDataUrls.push(url);
      }catch{
        showNotice("One of your photos could not be processed.", "err");
      }
    }

    renderPhotoPreview(window.__photoDataUrls);
  });

  // Submit
  $("#reviewForm").addEventListener("submit", (e) => {
    e.preventDefault();
    clearNotice();

    const restaurantId = $("#restaurantSelect").value.trim();
    const name = $("#displayName").value.trim();
    const rating = Number($("#rating").value);
    const text = $("#reviewText").value.trim();

    if (!restaurantId){
      showNotice("Pick a restaurant first.", "err");
      $("#restaurantSelect").focus();
      return;
    }
    if (!name){
      showNotice("Add your name (or your best undercover alias).", "err");
      $("#displayName").focus();
      return;
    }
    if (!(rating >= 1)){
      showNotice("Select a rating first. (The stars demand a number.)", "err");
      $("#starPicker").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (!text){
      showNotice("Write something. Even one sentence of evidence helps.", "err");
      $("#reviewText").focus();
      return;
    }

    const pending = loadPending();
    pending.unshift({
      id: uuid(),
      restaurantId,
      name,
      rating: Math.max(1, Math.min(5, rating)),
      text,
      photos: window.__photoDataUrls.slice(0, MAX_PHOTOS),
      createdAt: Date.now(),
      status: "pending"
    });
    savePending(pending);

    showNotice(
      `Submitted for moderation ✅<br><span class="muted small">It will appear publicly after approval.</span>`,
      "ok"
    );

    // Reset form except restaurant if locked
    $("#displayName").value = "";
setRating(0);
    $("#reviewText").value = "";
    $("#charCount").textContent = "0 / 1200";
    window.__photoDataUrls = [];
    $("#photos").value = "";
    renderPhotoPreview(window.__photoDataUrls);

    // Update mod list if enabled
    renderPendingList(window.__restaurants);
  });
});