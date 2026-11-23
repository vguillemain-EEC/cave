import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { positions, longueurMur, PROF, geometrie, placer, urgence, URGENCE } from "./dispo.js?v=27";

const CFG = window.CAVE_CONFIG;
const sb = createClient(CFG.supabaseUrl, CFG.supabaseKey);
const NOW = new Date().getFullYear();
const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const eur = (n) => (n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString("fr-FR") + " €");
const dfr = (d) => (d ? new Date(d).toLocaleDateString("fr-FR") : "—");
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

const COL = { rouge: "var(--wine)", blanc: "var(--white)", rose: "var(--rose)", effervescent: "var(--bubbles)", liquoreux: "var(--mature)", autre: "var(--muted)" };
const COUL_LIB = { rouge: "Rouge", blanc: "Blanc", rose: "Rosé", effervescent: "Effervescent", liquoreux: "Liquoreux", autre: "Autre" };
const PIC = { rouge: "img/rouge.jpg", blanc: "img/blanc.jpg", liquoreux: "img/blanc.jpg", rose: "img/blanc.jpg", effervescent: "img/champagne.jpg", autre: "img/rouge.jpg" };
const FORMES = { grille: "Grille bouteille par bouteille", cases: "Cases (petites grilles)", croix: "Croix (4 triangles)", diagonale: "Diagonale (2 triangles)", losange: "Losanges", vrac: "Case ouverte / vrac", clayette: "Clayette (cave électrique)" };
const MURS = { N: "Mur du fond (face à la porte)", E: "Mur de droite", O: "Mur de gauche", S: "Mur de la porte" };
const MOTIFS = ["Bu", "Offert", "Vendu", "Cassé", "Bouchonné", "Autre"];
const TYPES_RG = { grille: "Grille (rangée × colonne)", losange: "Casier losange", etagere: "Étagères et emplacements", caisse: "Caisse bois", vrac: "Vrac" };

let S = { user: null, slug: null, nom: "", view: "dashboard", arg: null, d: {}, urls: {}, ui: { cave: null, mode: "3d", periode: 12, filtre: "", couleur: "", jfiltre: "" } };
const T = (n) => `${S.slug}_${n}`;

/* ---------------- Utilitaires UI ---------------- */
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("on"), 2800); }
function modal(html, onReady) {
  const m = $("#modal"); m.innerHTML = `<form method="dialog" class="dlg">${html}</form>`;
  m.showModal(); onReady && onReady(m); return m;
}
function closeModal() { $("#modal").close(); }
async function q(p) { if (S.demo) { toast("Cave de démonstration : créez votre cave pour enregistrer vos vins."); throw new Error("cave de démonstration"); } const { data, error } = await p; if (error) { console.error(error); toast("Erreur : " + error.message); throw error; } return data; }
function fnErr(e) { return e?.context?.error || e?.message || "erreur inconnue"; }
async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  return data;
}

/* ---------------- Données ---------------- */
async function charger() {
  const tabs = ["caves", "rangements", "vins", "bouteilles", "mouvements", "prix", "photos"];
  const tri = { bouteilles: "entree_le", prix: "releve_le" };
  // Supabase plafonne chaque requête à 1000 lignes : on charge par pages
  const tout = async (t) => {
    const data = [];
    for (let de = 0; ; de += 1000) {
      const r = await sb.from(T(t)).select("*").order(tri[t] || "created_at", { ascending: true }).order("id", { ascending: true }).range(de, de + 999);
      if (r.error) return r;
      data.push(...r.data); if (r.data.length < 1000) return { data };
    }
  };
  const res = await Promise.all(tabs.map(tout));
  res.forEach((r, i) => { if (r.error) throw r.error; S.d[tabs[i]] = r.data; });
  await signerPhotos();
}
async function signerPhotos() {
  const chemins = [...new Set([...S.d.vins.map((v) => v.photo_principale), ...S.d.photos.map((p) => p.chemin)].filter(Boolean))].filter((c) => !S.urls[c]);
  if (!chemins.length) return;
  const { data } = await sb.storage.from("etiquettes").createSignedUrls(chemins, 3600 * 12);
  (data || []).forEach((x) => { if (x.signedUrl) S.urls[x.path] = x.signedUrl; });
}
const enCave = (vinId) => S.d.bouteilles.filter((b) => b.vin_id === vinId && b.statut === "en_cave");
const qte = (vinId) => enCave(vinId).length;
const vinsEnCave = () => S.d.vins.filter((v) => qte(v.id) > 0);
const valU = (v) => v.valeur_unitaire ?? v.prix_achat ?? null;
const sansAccent = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Visuel d'illustration quand le vin n'a pas de photo d'étiquette : choisi selon l'origine, la couleur et les cépages. */
function visuel(v) {
  const a = sansAccent([v.appellation, v.cuvee].join(" ")), rg = sansAccent(v.region), py = sansAccent(v.pays), c = v.couleur;
  const cep = sansAccent((Array.isArray(v.cepages) ? v.cepages : []).map((x) => x?.nom ?? x).join(" "));
  const t = a + " " + rg + " " + py + " " + cep, has = (...m) => m.some((x) => t.includes(x));
  const blanc = c === "blanc" || c === "liquoreux";
  let k = null;
  if (/150|magnum/.test(sansAccent(v.conditionnement))) k = "magnum";
  else if (c === "effervescent") k = has("champagne") ? "champagne" : "bulles";
  else if (c === "rose") k = has("provence", "bandol", "tavel") ? "rose-provence" : "rose";
  else if (has("champagne")) k = "champagne";
  else if (has("porto", "douro")) k = "porto";
  else if (has("rioja", "espagne", "ribera")) k = "rioja";
  else if (has("allemagne", "mosel", "pfalz", "rheingau", "baden")) k = blanc ? "allemagne-blanc" : "allemagne-rouge";
  else if (has("barolo", "barbaresco", "nebbiolo")) k = "barolo";
  else if (has("piemont", "piemonte", "barbera", "dolcetto", "roero", "langhe")) k = blanc ? "piemont-blanc" : "piemont-rouge";
  else if (has("italie", "toscan", "chianti", "montalcino", "valpolicella", "sicil", "puglia")) k = "italie-rouge";
  else if (has("chablis")) k = "chablis";
  else if (has("beaujolais", "morgon", "fleurie", "moulin-a-vent", "brouilly", "julienas", "chiroubles", "chenas", "regnie", "saint-amour")) k = "beaujolais";
  else if (has("bourgogne", "cote de nuits", "cote de beaune", "nuits", "beaune", "pommard", "volnay", "savigny", "ladoix", "mercurey", "givry", "rully", "gevrey", "chambolle", "vosne", "morey", "meursault", "puligny", "chassagne", "macon", "pouilly-fuisse", "santenay", "marsannay", "fixin", "aloxe", "corton", "auxey", "monthelie", "saint-romain", "maranges")) {
    k = blanc ? "bgn-blanc" : has("beaune", "pommard", "volnay", "savigny", "ladoix", "mercurey", "givry", "rully", "santenay", "aloxe", "corton", "auxey", "monthelie", "maranges") ? "bgn-beaune" : "bgn-nuits";
  } else if (has("bordeaux", "medoc", "margaux", "pauillac", "saint-julien", "saint-estephe", "listrac", "moulis", "saint-emilion", "pomerol", "fronsac", "pessac", "graves", "sauternes", "barsac", "entre-deux-mers", "blaye", "bourg", "castillon", "lalande")) {
    k = blanc ? "bdx-blanc" : has("saint-emilion", "pomerol", "fronsac", "castillon", "lalande") ? "bdx-rivedroite" : has("pessac", "graves") ? "bdx-graves" : has("margaux") ? "bdx-margaux" : "bdx-medoc";
  } else if (has("cheverny", "romorantin")) k = "loire-cheverny";
  else if (has("sancerre", "pouilly-fume", "menetou", "quincy", "reuilly", "touraine sauvignon") || (has("loire") && has("sauvignon"))) k = blanc ? "loire-sauvignon" : "loire-rouge";
  else if (has("jasnieres", "savennieres", "vouvray", "montlouis", "chenin", "anjou blanc", "coteaux du layon", "saumur blanc")) k = "loire-chenin";
  else if (has("loire", "chinon", "bourgueil", "saumur", "anjou", "touraine", "coteaux du loir", "muscadet")) k = blanc ? "loire-chenin" : "loire-rouge";
  else if (has("rhone", "rhodan", "hermitage", "crozes", "cornas", "saint-joseph", "cote-rotie", "cote rotie", "chateauneuf", "gigondas", "vacqueyras", "condrieu", "lirac", "rasteau", "ventoux")) k = blanc ? "rhone-blanc" : "rhone-rouge";
  else if (has("provence", "bandol", "palette", "cassis")) k = blanc ? "rose-provence" : "provence-rouge";
  else if (has("languedoc", "roussillon", "corbieres", "minervois", "pic saint-loup", "faugeres", "saint-chinian", "fitou", "collioure", "terrasses du larzac", "pays d'oc")) k = "languedoc";
  else if (has("sud-ouest", "sud ouest", "cahors", "madiran", "buzet", "bergerac", "gaillac", "fronton", "jurancon", "irouleguy", "marcillac", "cotes de gascogne")) k = "sudouest";
  else if (has("alsace", "riesling", "gewurz")) k = "alsace";
  else if (has("jura", "arbois", "savagnin", "vin jaune", "chateau-chalon")) k = "jura";
  else if (has("savoie", "mondeuse", "jacquere", "bugey", "chignin", "apremont")) k = "savoie";
  return k ? `img/vins/${k}.jpg` : null;
}
const pic = (v) => (v.photo_principale && S.urls[v.photo_principale]) || visuel(v) || PIC[v.couleur] || PIC.autre;
const labL = (r, l) => (r.libelle_lignes === "ABC" ? String.fromCharCode(64 + l) : `${r.libelle_lignes}${l}`);
const labC = (r, c) => `${r.libelle_colonnes ?? ""}${c}`;
const nomVin = (v) => `${v.domaine}${v.cuvee ? " · " + v.cuvee : ""} ${v.millesime ?? "NM"}`;
function phase(v) {
  if (!v.apogee_debut) return null;
  if (v.maturite_debut && NOW < v.maturite_debut) return "Jeunesse";
  if (NOW < v.apogee_debut) return "Maturité";
  if (NOW <= (v.apogee_fin ?? v.apogee_debut)) return "Apogée";
  return "Déclin";
}
// Profondeur d'un rangement (1 ou 2 bouteilles l'une derrière l'autre), stockée dans le plan de la cave
const profRg = (r) => (r && +S.d.caves.find((c) => c.id === r.cave_id)?.plan?.prof?.[r.id]) || 1;
const ARR = "Arrière";
const cleB = (b) => `${b.ligne}|${b.colonne}|${b.emplacement === ARR ? 2 : 1}`;
const capRg = (x) => (["caisse", "vrac"].includes(x.type) ? 0 : x.lignes * x.colonnes * profRg(x));
function emplacementTxt(b) {
  if (!b.rangement_id) return b.emplacement || "Non rangée";
  const r = S.d.rangements.find((x) => x.id === b.rangement_id); if (!r) return "Non rangée";
  const c = S.d.caves.find((x) => x.id === r.cave_id);
  const pos = b.ligne ? ` · ${labL(r, b.ligne)}${b.colonne ? (r.libelle_lignes === "ABC" ? "" : " ") + labC(r, b.colonne) : ""}` : b.emplacement ? " · " + b.emplacement : "";
  return `${c?.nom ?? ""} · ${r.nom}${pos}${b.ligne && b.emplacement === ARR ? " (arrière)" : ""}`;
}
async function journal(type, vin, quantite, detail, valeur = null, motif = null) {
  await q(sb.from(T("mouvements")).insert({ type, vin_id: vin?.id ?? null, vin_libelle: vin ? nomVin(vin) : null, quantite, detail, valeur, motif }));
}

/* ---------------- Auth ---------------- */
function vueLogin(err = "") {
  $("#app").innerHTML = `<div class="login"><div class="side"></div><div class="panel">
    <div class="brand" style="padding:0"><i></i>Cave</div>
    <div><h1>Connexion</h1><p class="muted" style="margin:4px 0 0">Ta cave, bouteille par bouteille.</p></div>
    <form id="flogin" class="stack">
      <label class="f">Identifiant<input id="lid" autocomplete="username" autocapitalize="none" required placeholder="ton identifiant"></label>
      <label class="f">Mot de passe<input id="lmdp" type="password" autocomplete="current-password" required></label>
      <div class="err">${esc(err)}</div>
      <button class="btn primary" type="submit">Se connecter</button>
    </form>
    <form id="fcode" class="code-par"><span>Pas encore de compte ? Entre ton code de parrainage</span><div class="row" style="gap:8px;flex-wrap:nowrap"><input id="lcode" placeholder="XXXX-XXXX" autocapitalize="characters" autocomplete="off" maxlength="12" style="text-transform:uppercase"><button class="btn">Créer mon compte</button></div></form></div></div>`;
  $("#fcode").onsubmit = (e) => { e.preventDefault(); const c = $("#lcode").value.toLowerCase().replace(/[^a-z0-9]/g, ""); if (c.length < 6) return toast("Code incomplet."); history.replaceState(null, "", "#invitation-" + c); vueInvitation(c); };
  $("#flogin").onsubmit = async (e) => {
    e.preventDefault();
    const id = $("#lid").value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const email = id.includes("@") ? id : `${id}@${CFG.domaineIdentifiant}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: $("#lmdp").value });
    if (error) return vueLogin("Identifiant ou mot de passe incorrect.");
    demarrer();
  };
}
async function demarrer() {
  const { data } = await sb.auth.getUser();
  const invit = location.hash.match(/^#invitation-([A-Za-z0-9-]+)$/);
  if (!data.user && invit) return vueInvitation(invit[1].toLowerCase().replace(/[^a-z0-9]/g, ""));
  if (!data.user) return vueLogin();
  S.user = data.user; S.slug = data.user.user_metadata?.slug; S.nom = data.user.user_metadata?.nom || S.slug;
  if (!S.slug) return vueLogin("Compte sans cave associée.");
  // Compte tout neuf : ses tables viennent d'être créées et le serveur peut mettre quelques secondes à les voir
  const chargerPatient = async () => { for (let i = 0; ; i++) { try { return await charger(); } catch (e) { if (i >= 7 || !/schema cache|does not exist/i.test(e.message || "")) throw e; $("#app").innerHTML = `<div class="empty"><span class="spin"></span><h2>Préparation de votre cave…</h2></div>`; await new Promise((r) => setTimeout(r, 1500)); } } };
  try { await chargerPatient(); } catch (e) { $("#app").innerHTML = `<div class="empty"><h2>Impossible de charger la cave</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-act="reload">Réessayer</button></div>`; return; }
  if (!S.d.vins.length && !S.d.rangements.length) await entrerDemo();
  coquille(); route();
  if (S.demo) setTimeout(accueilDemo, 600);
  else setTimeout(() => revalImport(), 2500);
}

/* ---------------- Coquille + navigation ---------------- */
const IC = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/></svg>',
  wines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 2h4v5l2 3v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10l2-3z"/><path d="M8 14h8"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></svg>',
  log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
};
const NAV = [["dashboard", "Dashboard", "dash"], ["vins", "Mes vins", "wines"], ["scan", "Scan", "scan"], ["journal", "Journal", "log"], ["compte", "Compte", "user"]];
function coquille() {
  $("#app").innerHTML = `<div class="app"><nav class="rail" id="rail"></nav><main><div class="wrap" id="view"></div></main><nav class="tabbar" id="tabbar"></nav></div>`;
}
function nav() {
  const cur = (k) => S.view === k || (S.view === "vin" && k === "vins");
  $("#rail").innerHTML = `<div class="brand"><i></i>Cave</div>${NAV.map((n) => `<a class="navbtn" href="#${n[0]}" aria-current="${cur(n[0])}">${IC[n[2]]}${n[1]}</a>`).join("")}<a class="navbtn parrainez" href="#parrainez" aria-current="${S.view === "parrainez"}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg>Parrainez<span class="pz-tag">Offrir</span></a><div class="user">${esc(S.nom)}</div>`;
  $("#tabbar").innerHTML = NAV.map((n) => `<a href="#${n[0]}" aria-current="${cur(n[0])}" style="display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px;color:${cur(n[0]) ? "var(--wine)" : "var(--muted)"};text-decoration:none;padding:4px 6px">${IC[n[2]].replace("<svg", '<svg width="22" height="22"')}${n[1]}</a>`).join("") + `<a href="#parrainez" class="tab-pz" aria-current="${S.view === "parrainez"}"><span><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/></svg></span>Parrainez</a>`;
  document.querySelectorAll(".navbtn").forEach((a) => (a.style.textDecoration = "none"));
}
function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || "dashboard";
  const [v, ...rest] = h.split("-"); S.view = v; S.arg = rest.join("-") || null;
  nav();
  const V = { scan: S.demo ? () => { vDashboard(); etapeCreation(); } : vScan, dashboard: vDashboard, vins: vVins, vin: vFiche, journal: vJournal, compte: vCompte, parrainez: () => { vCompte(); requestAnimationFrame(() => { const z = $("#parrain"); if (z) { z.scrollIntoView({ behavior: "smooth", block: "start" }); z.classList.add("flash"); $("#parnote")?.focus({ preventScroll: true }); } }); } }[S.view] || vDashboard;
  if (S.vue3d) { S.vue3d.dispose(); S.vue3d = null; }
  $("#view").innerHTML = ""; V(); window.scrollTo(0, 0);
  if (S.demo) $("#view").insertAdjacentHTML("afterbegin", `<div class="banner demo-bar"><span><b>Cave de démonstration</b> · 25 vins pour découvrir l'appli</span><span class="row" style="gap:8px"><button class="btn sm" data-act="tuto">Revoir le tutoriel</button><button class="btn sm primary" data-act="creer">Créer ma cave</button></span></div>`);
}
addEventListener("hashchange", () => S.user && route());
// Actions déclarées par attribut (pas de gestionnaire inline : compatible avec la politique de sécurité du contenu)
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el) return;
  const a = el.dataset.act;
  if (a === "reload") location.reload();
  else if (a === "scan-etiquette") { location.hash = "scan"; setTimeout(() => document.querySelector("[data-m=etiquette]")?.click(), 50); }
  else if (a === "creer") etapeCreation();
  else if (a === "hasard") rangerHasard(S.ui.cave);
  else if (a === "excel") S.demo ? toast("Cave de démonstration : créez votre cave pour importer vos vins.") : importExcel();
  else if (a === "tuto") tutoriel();
  else if (a === "conso-vu") { try { localStorage.setItem("conso-vu", el.dataset.k); } catch {} }
});
const go = (h) => { if (location.hash === "#" + h) route(); else location.hash = h; };
const refresh = async () => { await charger(); route(); };

/* ---------------- Dashboard ---------------- */
function prixA(vin, date) {
  const p = S.d.prix.filter((x) => x.vin_id === vin.id && x.devise === "EUR" && new Date(x.releve_le) <= date);
  if (!p.length) return vin.prix_achat ?? null;
  const last = new Date(p[p.length - 1].releve_le).toDateString();
  return median(p.filter((x) => new Date(x.releve_le).toDateString() === last).map((x) => +x.prix));
}
function serieValeur(mois) {
  const pts = []; const now = new Date();
  for (let i = mois; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59); const dd = i === 0 ? now : d;
    let s = 0;
    for (const b of S.d.bouteilles) {
      if (new Date(b.entree_le) > dd || (b.sortie_le && new Date(b.sortie_le) <= dd)) continue;
      const v = S.d.vins.find((x) => x.id === b.vin_id); if (!v) continue;
      s += i === 0 ? (valU(v) ?? 0) : (prixA(v, dd) ?? 0);
    }
    pts.push([dd, s]);
  }
  return pts;
}
function courbe(pts, h = 150) {
  const w = 560, p = 26; const vals = pts.map((x) => x[1]); let mn = Math.min(...vals), mx = Math.max(...vals);
  if (mx === mn) { mx = mx * 1.05 + 1; mn = mn * 0.95; }
  const X = (i) => p + (i * (w - 2 * p)) / Math.max(1, pts.length - 1), Y = (v) => h - p - ((v - mn) / (mx - mn)) * (h - 2 * p);
  const d = pts.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`).join("");
  const step = Math.ceil(pts.length / 6);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Évolution de la valeur">
    ${[0, 1, 2].map((k) => `<line x1="${p}" x2="${w - p}" y1="${p + (k * (h - 2 * p)) / 2}" y2="${p + (k * (h - 2 * p)) / 2}" stroke="var(--line)" stroke-dasharray="2 4"/>`).join("")}
    <path d="${d}L${X(pts.length - 1)},${h - p}L${p},${h - p}Z" fill="var(--wine)" opacity=".12"/><path d="${d}" fill="none" stroke="var(--wine)" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="${X(pts.length - 1)}" cy="${Y(vals[vals.length - 1])}" r="5" fill="var(--wine)"/>
    ${pts.map((x, i) => (i % step && i !== pts.length - 1 ? "" : `<text x="${X(i)}" y="${h - 6}" text-anchor="middle">${x[0].toLocaleDateString("fr-FR", { month: "short", year: pts.length > 13 ? "2-digit" : undefined })}</text>`)).join("")}
  </svg>`;
}
/* ---------------- Carte des origines : Europe → pays → région, avec zoom ---------------- */
const REG_FR = [["Bordeaux", ["bordeaux", "medoc", "graves", "saint-emilion", "pomerol", "sauternes", "entre-deux-mers"]], ["Sud-Ouest", ["sud-ouest", "sud ouest", "cahors", "madiran", "bergerac", "gaillac", "jurancon", "buzet", "fronton", "gascogne", "irouleguy"]], ["Bourgogne", ["bourgogne", "chablis", "cote de nuits", "cote de beaune", "maconnais", "chalonnaise"]], ["Beaujolais", ["beaujolais"]], ["Champagne", ["champagne"]], ["Alsace", ["alsace"]], ["Lorraine", ["lorraine", "moselle", "cotes de toul"]], ["Jura", ["jura"]], ["Savoie", ["savoie", "bugey"]], ["Vallée du Rhône", ["rhone", "rhodan"]], ["Vallée de la Loire", ["loire", "anjou", "touraine", "sancerre", "muscadet", "saumur", "vouvray", "chinon"]], ["Provence", ["provence", "bandol", "cassis"]], ["Languedoc-Roussillon", ["languedoc", "roussillon", "corbieres", "minervois", "pays d'oc"]], ["Corse", ["corse"]], ["Charentes", ["charente", "cognac", "pineau"]], ["Normandie", ["normandie", "calvados"]]];
const REG_ETR = {"Italie": [["Piémont", ["piemont"]], ["Toscane", ["toscan"]], ["Ombrie", ["ombrie", "umbria"]], ["Vénétie", ["venet"]], ["Sicile", ["sicil"]], ["Pouilles", ["pouille", "puglia"]], ["Lombardie", ["lombard"]], ["Frioul", ["frioul", "friuli"]], ["Trentin-Haut-Adige", ["trentin", "alto adige", "haut-adige"]], ["Abruzzes", ["abruzz"]], ["Campanie", ["campan"]], ["Sardaigne", ["sardaign", "sardegna"]]], "Allemagne": [["Württemberg", ["wurttemberg"]], ["Baden", ["baden"]], ["Nahe", ["nahe"]], ["Pfalz", ["pfalz", "palatinat"]], ["Mosel", ["mosel"]], ["Rheingau", ["rheingau"]], ["Rheinhessen", ["rheinhessen"]], ["Franken", ["franken", "franconie"]]], "Espagne": [["Rioja", ["rioja"]], ["Ribera del Duero", ["ribera"]], ["Priorat", ["priorat"]], ["Jerez", ["jerez", "xeres"]], ["Galice", ["galic", "rias baixas"]]], "Portugal": [["Douro", ["douro", "porto"]], ["Alentejo", ["alentejo"]], ["Vinho Verde", ["vinho verde", "minho"]], ["Dão", ["dao"]]], "Suisse": [["Valais", ["valais"]], ["Vaud", ["vaud", "lavaux"]]], "Autriche": [["Wachau", ["wachau"]], ["Burgenland", ["burgenland"]]]};
const PAYS_NOMS = { france: "France", italie: "Italie", italy: "Italie", espagne: "Espagne", spain: "Espagne", portugal: "Portugal", allemagne: "Allemagne", germany: "Allemagne", suisse: "Suisse", autriche: "Autriche", hongrie: "Hongrie", grece: "Grèce", belgique: "Belgique", luxembourg: "Luxembourg", slovenie: "Slovénie", croatie: "Croatie", roumanie: "Roumanie", georgie: "Géorgie", liban: "Liban", "etats-unis": "États-Unis", usa: "États-Unis", argentine: "Argentine", chili: "Chili", "afrique du sud": "Afrique du Sud", australie: "Australie", "nouvelle-zelande": "Nouvelle-Zélande" };
/** Pays et région viticole d'un vin, normalisés pour la carte. */
function origine(v) {
  const t = sansAccent(`${v.region ?? ""} ${v.appellation ?? ""}`), py0 = sansAccent(v.pays).trim();
  let pays = PAYS_NOMS[py0] || (v.pays ? v.pays.trim() : null);
  const fr = REG_FR.find(([, m]) => m.some((x) => t.includes(x)));
  if (!pays && fr) pays = "France";
  if (pays === "France") return { pays, region: fr ? fr[0] : v.region || "Autres" };
  const e = (REG_ETR[pays] || []).find(([, m]) => m.some((x) => t.includes(x)));
  return { pays: pays || "Inconnu", region: e ? e[0] : v.region || "Autres" };
}
let CARTE = null;
const carteGeo = async () => (CARTE ??= await (await fetch("carte.json?v=22")).json());
function carteCadre() { return `<div id="carteo" class="carteo"><div class="muted" style="padding:20px">Chargement de la carte…</div></div>`; }
async function monterCarte() {
  const z = $("#carteo"); if (!z) return;
  let G; try { G = await carteGeo(); } catch { z.innerHTML = `<div class="muted">Carte indisponible.</div>`; return; }
  const vins = vinsEnCave().map((v) => ({ v, o: origine(v), n: qte(v.id) }));
  const st = (S.ui.carte ??= { niv: "europe" });
  const somme = (f) => vins.filter(f).reduce((s, x) => s + x.n, 0);
  const teinte = (n, max) => (n ? `color-mix(in srgb, var(--wine) ${Math.round(18 + 62 * Math.sqrt(n / Math.max(1, max)))}%, var(--surface))` : "var(--sunk)");
  let bmax = 1, ech = 1; const etiq = [];
  const bulle = (cx, cy, n, nom, attr = "") => {
    const r = (9 + 15 * Math.sqrt(n / bmax)) / ech, fs = 12 / ech, lw = String(nom).length * fs * 0.56, ly = cy + r + fs * 1.05;
    const libre = !etiq.some((e) => Math.abs(e.x - cx) < (e.w + lw) / 2 && Math.abs(e.y - ly) < fs * 1.1) && !etiq.some((e) => Math.hypot(e.cx - cx, e.cy - cy) < e.r + r * 0.6 && e.y !== ly);
    etiq.push({ x: cx, y: ly, w: lw, cx, cy, r });
    return `<g class="cg-b" ${attr}><title>${esc(nom)} · ${n} bt</title><circle cx="${cx}" cy="${cy}" r="${r}" style="stroke-width:${2 / ech}"/><text x="${cx}" y="${cy + 4 / ech}" text-anchor="middle" class="cg-n" style="font-size:${11 / ech}px">${n}</text>${libre ? `<text x="${cx}" y="${ly}" text-anchor="middle" class="cg-l" style="font-size:${fs}px;stroke-width:${3 / ech}px">${esc(nom)}</text>` : ""}</g>`;
  };
  const boite = (d) => { const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number); let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (let i = 0; i + 1 < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); } return [x0, y0, x1, y1]; };
  let vb = null;
  const liste = (sel, titre, cle = (x) => x.v.appellation || "Sans appellation") => {
    const l = vins.filter(sel).sort((a, b) => b.n - a.n);
    const apps = {}; l.forEach((x) => { const k = cle(x); apps[k] = (apps[k] || 0) + x.n; });
    return `<div class="cg-liste"><div class="row" style="justify-content:space-between"><b>${esc(titre)}</b><span class="muted">${l.reduce((s, x) => s + x.n, 0)} bt · ${l.length} vins</span></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${Object.entries(apps).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([a, n]) => `<button class="chip${st.app === a ? " on" : ""}" data-app="${esc(a)}">${esc(a)} <span class="num muted">${n}</span></button>`).join("")}</div>
      <div class="cg-vins">${l.filter((x) => !st.app || cle(x) === st.app).slice(0, 40).map((x) => `<a class="cg-li" href="#vin-${x.v.id}"><img src="${esc(pic(x.v))}" alt=""><span><b>${esc(nomVin(x.v))}</b><br><span class="muted" style="font-size:12px">${esc(x.v.appellation ?? x.v.region ?? "")}</span></span><span class="num">${x.n}</span></a>`).join("")}</div></div>`;
  };
  const fil = [`<button data-niv="europe">Europe</button>`];
  if (st.niv !== "europe") fil.push(`<button data-niv="pays">${esc(st.pays)}</button>`);
  if (st.niv === "region") fil.push(st.dep ? `<button data-niv="region">${esc(st.region)}</button>` : `<b>${esc(st.region)}</b>`);
  let svg = "", bas = "";
  if (st.niv === "europe") {
    const parPays = {}; vins.forEach((x) => (parPays[x.o.pays] = (parPays[x.o.pays] || 0) + x.n));
    const max = Math.max(...Object.values(parPays), 1); bmax = max;
    svg = `<path d="${G.europe.fond}" class="cg-fond"/>` + G.europe.pays.map((p) => `<path d="${p.d}" class="cg-z${parPays[p.nom] ? " actif" : ""}" style="fill:${teinte(parPays[p.nom] || 0, max)}" ${parPays[p.nom] ? `data-pays="${esc(p.nom)}"` : ""}><title>${esc(p.nom)} · ${parPays[p.nom] || 0} bt</title></path>`).join("")
      + G.europe.pays.filter((p) => parPays[p.nom]).map((p) => bulle(p.cx, p.cy, parPays[p.nom], p.nom, `data-pays="${esc(p.nom)}"`)).join("");
    const ailleurs = Object.entries(parPays).filter(([p]) => !G.europe.pays.some((x) => x.nom === p));
    bas = (ailleurs.length ? `<div class="row" style="gap:6px;flex-wrap:wrap"><span class="eyebrow">Ailleurs</span>${ailleurs.map(([p, n]) => `<button class="chip" data-pays="${esc(p)}">${esc(p)} <span class="num muted">${n}</span></button>`).join("")}</div>` : "")
      + `<div class="muted" style="font-size:12px">Touche un pays pour zoomer.</div>`;
  } else if (st.niv === "pays") {
    const P = G.pays[st.pays], parReg = {}; vins.filter((x) => x.o.pays === st.pays).forEach((x) => (parReg[x.o.region] = (parReg[x.o.region] || 0) + x.n));
    const max = Math.max(...Object.values(parReg), 1); bmax = max;
    if (P) {
      svg = `<path d="${P.d}" class="cg-fond${st.pays === "France" ? "" : " cg-pays"}"/>`;
      if (st.pays === "France") svg += P.regions.map((r) => `<path d="${r.d}" class="cg-z${parReg[r.nom] ? " actif" : ""}" style="fill:${teinte(parReg[r.nom] || 0, max)}" data-region="${esc(r.nom)}"><title>${esc(r.nom)} · ${parReg[r.nom] || 0} bt</title></path>`).join("");
      const places = new Set();
      svg += P.regions.filter((r) => parReg[r.nom]).map((r) => { places.add(r.nom); return bulle(r.cx, r.cy, parReg[r.nom], r.nom, `data-region="${esc(r.nom)}"`); }).join("");
      const reste = Object.entries(parReg).filter(([r]) => !places.has(r));
      reste.forEach(([r, n], i) => (svg += bulle((P.cx ?? G.W / 2) + i * 46 - (reste.length - 1) * 23, P.cy ?? G.H / 2, n, r, `data-region="${esc(r)}"`)));
    }
    bas = st.region ? liste((x) => x.o.pays === st.pays && x.o.region === st.region, st.region) : liste((x) => x.o.pays === st.pays, st.pays, (x) => x.o.region);
    if (!P) svg = "";
  } else {
    const R = G.regions[st.region], ici = vins.filter((x) => x.o.pays === "France" && x.o.region === st.region);
    // appellations placées sur la carte
    const cles = (R?.apps || []).slice().sort((p, q) => q[0].length - p[0].length);
    const cleDe = (x) => { const t = sansAccent(x.v.appellation || ""); return cles.find((c) => t.includes(c[0])) || null; };
    const parCle = {}; ici.forEach((x) => { const c = cleDe(x); if (!c) return; const o = (parCle[c[0]] ??= { c, n: 0, noms: {} }); o.n += x.n; const a = x.v.appellation; o.noms[a] = (o.noms[a] || 0) + x.n; });
    const libelle = (o) => Object.entries(o.noms).sort((p, q) => q[1] - p[1])[0][0];
    bmax = Math.max(1, ...Object.values(parCle).map((o) => o.n));
    const dz = st.dep && R?.deps.find((d) => d.code === st.dep);
    const pts = Object.values(parCle).map((o) => [o.c[1], o.c[2]]);
    const dedansDep = dz ? pts.filter(([x, y]) => { const [a0, b0, a1, b1] = boite(dz.d); return x >= a0 && x <= a1 && y >= b0 && y <= b1; }) : [];
    if (dz && dedansDep.length >= 2) { const xs = dedansDep.map((q) => q[0]), ys = dedansDep.map((q) => q[1]); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys); const w = Math.max(70, x1 - x0, (y1 - y0) * G.W / G.H) * 1.5, h = w * G.H / G.W; vb = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h]; ech = G.W / w; }
    else if (dz) { const [x0, y0, x1, y1] = boite(dz.d), m = 14, w = Math.max(x1 - x0, (y1 - y0) * G.W / G.H) + 2 * m, h = w * G.H / G.W; vb = [(x0 + x1) / 2 - w / 2, (y0 + y1) / 2 - h / 2, w, h]; ech = G.W / w; }
    if (st.dep) fil.push(`<b>${esc(dz?.nom ?? "")}</b>`);
    svg = R ? R.deps.map((d) => `<path d="${d.d}" class="cg-z cg-dep${R.deps.length > 1 ? " actif" : ""}" style="fill:color-mix(in srgb, var(--wine) ${st.dep === d.code ? 30 : 18}%, var(--surface));stroke-width:${1.4 / ech}" ${R.deps.length > 1 ? `data-dep="${d.code}"` : ""}><title>${esc(d.nom)} · toucher pour zoomer</title></path>`).join("") + R.deps.map((d) => `<text x="${d.cx}" y="${d.cy}" text-anchor="middle" class="cg-d" style="font-size:${13 / ech}px">${esc(d.nom)}</text>`).join("")
      + (() => {
        // écarte les bulles qui se chevauchent, pour qu'on puisse toucher chacune
        const bs = Object.values(parCle).sort((p, q) => q.n - p.n).map((o) => ({ o, x: o.c[1], y: o.c[2], r: (9 + 15 * Math.sqrt(o.n / bmax)) / ech }));
        for (let it = 0; it < 80; it++) for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
          const a = bs[i], c = bs[j], dx = c.x - a.x, dy = c.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + c.r + 2 / ech;
          if (d < min) { const k = (min - d) / 2, ux = dx / d, uy = dy / d; a.x -= ux * k; a.y -= uy * k; c.x += ux * k; c.y += uy * k; }
        }
        return bs.map((b) => bulle(+b.x.toFixed(1), +b.y.toFixed(1), b.o.n, libelle(b.o), `data-app="${esc(libelle(b.o))}"`)).join("");
      })() : "";
    const cle = (x) => { const c = cleDe(x); return c && parCle[c[0]] ? libelle(parCle[c[0]]) : x.v.appellation || "Sans appellation"; };
    bas = liste((x) => x.o.pays === "France" && x.o.region === st.region, st.region, cle);
  }
  z.innerHTML = `<div class="cg-fil">${fil.join('<span class="muted">›</span>')}</div>${svg ? `<svg viewBox="${vb ? vb.map((x) => x.toFixed(1)).join(" ") : `0 0 ${G.W} ${G.H}`}" class="cg-svg zoomin" role="img" aria-label="Carte des origines">${svg}</svg>` : ""}${bas}`;
  const aller = (o) => { Object.assign(st, o); monterCarte(); };
  z.querySelectorAll("[data-niv]").forEach((b) => (b.onclick = () => aller(b.dataset.niv === "europe" ? { niv: "europe", region: null, app: null, dep: null } : b.dataset.niv === "region" ? { dep: null, app: null } : { niv: "pays", region: null, app: null, dep: null })));
  z.querySelectorAll("[data-dep]").forEach((b) => (b.onclick = () => aller({ dep: st.dep === b.dataset.dep ? null : b.dataset.dep, app: null })));
  z.querySelectorAll("[data-pays]").forEach((b) => (b.onclick = () => aller({ niv: "pays", pays: b.dataset.pays, region: null, app: null, dep: null })));
  z.querySelectorAll("[data-region]").forEach((b) => (b.onclick = () => { const r = b.dataset.region; if (st.pays === "France" && G.regions[r]) aller({ niv: "region", region: r, app: null, dep: null }); else aller({ region: st.region === r ? null : r, app: null }); }));
  z.querySelectorAll("[data-app]").forEach((b) => (b.onclick = () => aller({ app: st.app === b.dataset.app ? null : b.dataset.app })));
}
function horloge(vins) {
  const avec = vins.filter((v) => v.apogee_debut).slice(0, 8);
  if (!avec.length) return `<div class="muted">Les fenêtres de dégustation apparaîtront après les premiers scans.</div>`;
  const s = Math.min(NOW - 4, ...avec.map((v) => v.maturite_debut || v.apogee_debut)), e = Math.max(NOW + 10, ...avec.map((v) => v.declin_debut || v.apogee_fin || v.apogee_debut)) + 2;
  const X = (y) => Math.max(0, Math.min(100, ((y - s) / (e - s)) * 100));
  const rows = avec.map((v) => { const m = v.maturite_debut || v.apogee_debut, a0 = v.apogee_debut, a1 = v.apogee_fin || a0, dc = v.declin_debut || a1 + 3;
    return `<a href="#vin-${v.id}" class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);text-decoration:none">${esc(v.domaine)} ${v.millesime ?? ""}</a>
    <div class="wbar" title="${phase(v)}"><span style="left:${X(m)}%;width:${X(a0) - X(m)}%;background:var(--mature);opacity:.55"></span><span style="left:${X(a0)}%;width:${Math.max(1, X(a1) - X(a0))}%;background:var(--peak)"></span><span style="left:${X(a1)}%;width:${X(dc) - X(a1)}%;background:var(--decline);opacity:.45"></span><span style="left:${X(NOW)}%;width:2px;background:var(--fg)"></span></div>`; }).join("");
  const ticks = [s, Math.round((s + e) / 2), e];
  return `<div class="window">${rows}<div></div><div class="row muted" style="justify-content:space-between;font-size:11px">${ticks.map((t) => `<span>${t}</span>`).join("")}</div></div>
  <div class="row" style="font-size:12px"><span class="chip"><b style="background:var(--mature)"></b>Maturité</span><span class="chip"><b style="background:var(--peak)"></b>Apogée</span><span class="chip"><b style="background:var(--decline)"></b>Déclin</span><span class="chip"><b style="background:var(--fg)"></b>Aujourd'hui</span></div>`;
}
function donut(vins, cle) {
  const g = {}; let tot = 0;
  vins.forEach((v) => { const k = cle === "couleur" ? v.couleur || "autre" : (v[cle] || "Non renseigné"); g[k] = (g[k] || 0) + qte(v.id); tot += qte(v.id); });
  const pal = ["var(--wine)", "var(--white)", "var(--bubbles)", "var(--rose)", "var(--young)", "var(--decline)", "var(--mature)", "var(--muted)"];
  const ent = Object.entries(g).sort((a, b) => b[1] - a[1]); let a = 0; const R = 54, C = 2 * Math.PI * R;
  const color = (k, i) => (cle === "couleur" ? COL[k] : pal[i % pal.length]);
  const arcs = ent.map(([k, v], i) => { const l = (v / tot) * C; const s2 = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${color(k, i)}" stroke-width="18" stroke-dasharray="${Math.max(0, l - 2)} ${C}" stroke-dashoffset="${-a}" transform="rotate(-90 70 70)"/>`; a += l; return s2; }).join("");
  return `<div class="row" style="gap:18px;flex-wrap:nowrap"><svg viewBox="0 0 140 140" width="130" height="130" style="flex:none">${arcs}<text x="70" y="68" text-anchor="middle" style="font-family:var(--display);font-size:26px;font-weight:800;fill:var(--fg)">${tot}</text><text x="70" y="86" text-anchor="middle">bouteilles</text></svg>
    <div style="display:flex;flex-direction:column;gap:6px;min-width:0">${ent.slice(0, 7).map(([k, v], i) => `<span class="chip" style="background:none;padding:0"><b style="background:${color(k, i)}"></b>${esc(cle === "couleur" ? COUL_LIB[k] : k)} <span class="num muted">${v}</span></span>`).join("")}</div></div>`;
}
/* ---------------- Trouver un vin en 3D ---------------- */
function voir3d(vinId, bId) {
  const bs = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.vin_id === vinId && b.rangement_id);
  const b = bs.find((x) => x.id === bId) || bs[0]; if (!b) return toast("Aucune bouteille rangée pour ce vin.");
  S.ui.trouver = { vin: vinId, b: b.id }; S.ui.mode = "3d"; S.ui.cave = S.d.rangements.find((r) => r.id === b.rangement_id)?.cave_id ?? S.ui.cave;
  if (location.hash === "#vins") route(); else location.hash = "#vins";
}
/* ---------------- Accord mets et vins : Claude choisit dans la cave ---------------- */
const PLATS = ["Côte de bœuf", "Huîtres", "Poulet rôti", "Plateau de fromages", "Saumon", "Gibier", "Sushis", "Dessert au chocolat"];
function blocAccord() {
  return `<section class="card c12 accord"><div class="row" style="justify-content:space-between"><h2>Quel vin pour ce plat ?</h2><span class="muted" style="font-size:12px">Claude choisit dans ta cave</span></div>
    <form id="acf" class="row" style="flex-wrap:nowrap;gap:8px"><label class="search" style="max-width:none;flex:1"><input id="acq" placeholder="Ex. magret de canard aux cerises, risotto aux cèpes…" autocomplete="off" enterkeyhint="search"></label><button class="btn primary" id="acb">Trouver</button></form>
    <div class="row" style="gap:6px">${PLATS.map((p) => `<button class="chip" type="button" data-plat="${esc(p)}">${esc(p)}</button>`).join("")}</div>
    <div id="acr"></div></section>`;
}
function lignesCave() {
  const ids = [];
  const lignes = vinsEnCave().filter((v) => qte(v.id) > 0).map((v, i) => {
    ids.push(v.id);
    const cep = (v.cepages || []).map((c) => c.nom).filter(Boolean).join("/");
    return `v${i} | ${[v.domaine, v.cuvee, v.millesime ?? "NM"].filter(Boolean).join(", ")} | ${[v.appellation, v.region, v.pays].filter(Boolean).join(", ")} | ${v.couleur ?? ""} | ${cep} | ${phase(v) ?? "?"} | ${qte(v.id)}`;
  });
  return { ids, lignes };
}
async function chercherAccord(plat) {
  plat = plat.trim(); if (!plat) return;
  const z = $("#acr"); $("#acq").value = plat;
  z.innerHTML = `<div class="muted row" style="gap:8px;padding:10px 0"><span class="spin"></span> Claude parcourt ta cave…</div>`;
  const { ids, lignes } = lignesCave();
  try {
    const r = await callFn("accord", { plat, vins: lignes });
    const choix = (r.choix || []).map((c) => ({ ...c, v: S.d.vins.find((x) => x.id === ids[+String(c.id).replace(/\D/g, "")]) })).filter((c) => c.v);
    z.innerHTML = `${r.principe ? `<p class="muted" style="margin:4px 0 0">${esc(r.principe)}</p>` : ""}
      <div class="acc-liste">${choix.map((c, i) => { const b = S.d.bouteilles.find((x) => x.statut === "en_cave" && x.vin_id === c.v.id && x.rangement_id) || S.d.bouteilles.find((x) => x.statut === "en_cave" && x.vin_id === c.v.id);
        return `<div class="acc"><img src="${esc(pic(c.v))}" alt=""><div style="min-width:0"><div class="eyebrow">${i ? "Autre choix" : "Notre choix"}</div><b>${esc(nomVin(c.v))}</b>
        <div class="muted" style="font-size:12px">${esc([c.v.appellation, c.v.region].filter(Boolean).join(" · "))} · ${qte(c.v.id)} bt · ${esc(b ? emplacementTxt(b) : "")}</div>
        <div style="font-size:14px;margin-top:4px">${esc(c.pourquoi ?? "")}</div>${c.service ? `<div class="muted" style="font-size:12px;margin-top:2px">Service : ${esc(c.service)}</div>` : ""}
        <div class="row" style="gap:6px;margin-top:6px">${b?.rangement_id ? `<button class="btn sm primary" data-acc3d="${c.v.id}">Voir dans la cave</button>` : ""}<a class="btn sm" href="#vin-${c.v.id}">Fiche</a></div></div></div>`; }).join("") || `<div class="muted">Aucun vin de ta cave ne convient vraiment.</div>`}</div>
      ${r.a_eviter ? `<div class="muted" style="font-size:13px">À éviter : ${esc(r.a_eviter)}</div>` : ""}${r.ideal_hors_cave ? `<div class="muted" style="font-size:13px">L'idéal à acheter : ${esc(r.ideal_hors_cave)}</div>` : ""}
      <div class="src">Recommandation : <span class="s">${esc(r.source ?? "Claude")}</span><span>· parmi les ${ids.length} vins de ta cave</span></div>`;
    z.querySelectorAll("[data-acc3d]").forEach((el) => (el.onclick = () => voir3d(el.dataset.acc3d)));
  } catch (e) { z.innerHTML = `<div class="banner"><span>${esc(e.message)}</span></div>`; }
}
function brancherAccord() {
  const f = $("#acf"); if (!f) return;
  f.onsubmit = (e) => { e.preventDefault(); chercherAccord($("#acq").value); };
  document.querySelectorAll("[data-plat]").forEach((b) => (b.onclick = () => chercherAccord(b.dataset.plat)));
}
function vDashboard() {
  const vins = vinsEnCave(); const btl = vins.reduce((s, v) => s + qte(v.id), 0);
  const val = vins.reduce((s, v) => s + qte(v.id) * (valU(v) ?? 0), 0), achat = vins.reduce((s, v) => s + qte(v.id) * (v.prix_achat ?? valU(v) ?? 0), 0), gain = val - achat;
  const jour = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const hero = `<div class="hero"><div style="display:flex;flex-direction:column;gap:14px;width:100%"><div><div class="eyebrow">${esc(jour)}</div><h1>Bonjour ${esc(S.nom.split(" ")[0])}</h1></div>
    <div style="position:relative;max-width:460px"><label class="search" style="max-width:none">${IC.scan.replace("<svg", '<svg width="16" height="16"')}<input id="qg" placeholder="Rechercher un vin, un domaine, une appellation…" autocomplete="off"></label><div id="qgres"></div></div></div></div>`;
  if (S.user.user_metadata?.doit_changer_mdp) S._banner = `<div class="banner"><span>Pense à remplacer ton mot de passe initial.</span><a class="btn sm" href="#compte">Changer</a></div>`; else S._banner = "";
  S._banner += bandeauConso();
  if (!S.d.vins.length) {
    $("#view").innerHTML = hero + S._banner + `<section class="card empty"><h2>Ta cave est vide</h2><p class="muted" style="max-width:420px;margin:0">Commence par créer ta cave et ses rangements, puis scanne ta première bouteille.</p><div class="row" style="justify-content:center"><a class="btn" href="#vins">Créer une cave</a><a class="btn primary" href="#scan">Scanner une bouteille</a></div></section>`;
    rechercheGlobale(); return;
  }
  const ready = vins.filter((v) => phase(v) === "Apogée");
  const lastB = S.d.bouteilles.filter((b) => b.statut === "en_cave").sort((a, b) => new Date(b.entree_le) - new Date(a.entree_le))[0];
  const last = lastB && S.d.vins.find((v) => v.id === lastB.vin_id);
  const derniereMaj = S.d.vins.map((v) => v.valeur_maj).filter(Boolean).sort().pop();
  const per = S.ui.periode; const rep = S.ui.rep || "couleur";
  $("#view").innerHTML = hero + S._banner + `<div class="grid">
    <section class="card c12 cesoir" id="cesoir"></section>
    ${blocAccord()}
    <section class="card c8"><div class="row" style="justify-content:space-between"><h2>Valeur de la cave</h2><div class="seg" id="per">${[[3, "3M"], [12, "1A"], [60, "5A"]].map(([m, l]) => `<button data-p="${m}" aria-pressed="${per === m}">${l}</button>`).join("")}</div></div>
      <div class="row" style="gap:28px;align-items:flex-end"><div><div class="big">${eur(val)}</div><div class="muted">Valeur de marché estimée</div>${(() => { const n = vins.filter((v) => qte(v.id) && valU(v) == null).length; return n ? `<a href="#vins" class="sans-cote">${n} vin${n > 1 ? "s" : ""} sans cote, non compté${n > 1 ? "s" : ""}</a>` : ""; })()}</div>
      <div><div class="num ${gain >= 0 ? "up" : "down"}" style="font-size:18px;font-weight:600">${gain >= 0 ? "+" : ""}${eur(gain)}</div><div class="muted">${achat ? `${gain >= 0 ? "+" : ""}${((gain / achat) * 100).toFixed(0)} % vs achat (${eur(achat)})` : "Prix d'achat non renseignés"}</div></div>
      <div><div class="num" style="font-size:18px;font-weight:600">${btl}</div><div class="muted">bouteilles · ${vins.length} références</div></div></div>
      ${courbe(serieValeur(per))}
      <div class="src">Sources : <span class="s">wineapi.io</span><span class="s">cotes saisies</span><span class="s">prix d'achat</span>${derniereMaj ? `<span>· dernière mise à jour ${dfr(derniereMaj)}</span>` : ""}<button class="link" id="reval" style="margin-left:auto">Tout réévaluer</button></div></section>
    <section class="card c4"><h2>À boire maintenant</h2><div class="muted">${ready.length ? `${ready.length} vin${ready.length > 1 ? "s sont" : " est"} dans sa fenêtre d'apogée.` : "Aucun vin n'est à son apogée pour l'instant."}</div>
      ${ready.slice(0, 5).map((v) => `<a class="li" href="#vin-${v.id}" style="grid-template-columns:40px 1fr auto;text-decoration:none;color:inherit"><img class="thumb" src="${esc(pic(v))}" alt=""><span><b>${esc(v.domaine)}</b><br><span class="muted">${esc(v.appellation ?? "")} ${v.millesime ?? ""}</span></span><span class="num muted">×${qte(v.id)}</span></a>`).join("")}</section>
    <section class="card c7"><div class="row" style="justify-content:space-between"><h2>Carte des origines</h2><span class="muted">${new Set(vins.map((v) => origine(v).region)).size} régions · ${new Set(vins.map((v) => origine(v).pays)).size} pays</span></div>${carteCadre()}</section>
    <section class="card c5" id="horl"></section>
    <section class="card c4"><div class="row" style="justify-content:space-between"><h2>Répartition</h2><select id="rep" style="width:auto;padding:4px 8px">${[["couleur", "Couleur"], ["region", "Région"], ["pays", "Pays"], ["millesime", "Millésime"]].map(([k, l]) => `<option value="${k}" ${rep === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>${donut(vins, rep)}</section>
    <section class="card c4"><h2>Dernier vin entré</h2>${last ? `<a class="li" href="#vin-${last.id}" style="grid-template-columns:56px 1fr;border:0;padding:0;text-decoration:none;color:inherit"><img src="${esc(pic(last))}" alt="" style="width:56px;height:84px;object-fit:cover;border-radius:8px"><span><b>${esc(nomVin(last))}</b><br><span class="muted">${esc(last.appellation ?? "")} · ${esc(last.conditionnement ?? "")}</span><br><span class="muted">Ajouté le ${dfr(lastB.entree_le)} · ${esc(emplacementTxt(lastB))}</span></span></a>` : ""}</section>
    <section class="card c4" id="pv"></section>
  </div>`;
  $("#per").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.ui.periode = +b.dataset.p; vDashboard(); } };
  $("#rep").onchange = (e) => { S.ui.rep = e.target.value; vDashboard(); };
  $("#reval").onclick = () => reevaluerTout();
  rechercheGlobale(); brancherAccord(); monterCarte(); ceSoir(vins); horlogeApogee(vins); plusValues(vins);
}
/* ---------------- Ce soir on ouvre quoi ? ---------------- */
let METEO;
const meteo = async () => {
  if (METEO !== undefined) return METEO;
  try {
    const c = new AbortController(); setTimeout(() => c.abort(), 3500);
    const r = await (await fetch("https://api.open-meteo.com/v1/forecast?latitude=48.85&longitude=2.35&current=temperature_2m,weather_code", { signal: c.signal })).json();
    METEO = { t: Math.round(r.current.temperature_2m), code: r.current.weather_code };
  } catch { METEO = null; }
  return METEO;
};
const CIEL = (c) => (c == null ? "" : c <= 1 ? "ciel dégagé" : c <= 3 ? "nuageux" : c <= 48 ? "brumeux" : c <= 67 ? "pluie" : c <= 77 ? "neige" : c <= 82 ? "averses" : "orage");
async function ceSoir(vins) {
  const z = $("#cesoir"); if (!z) return;
  const d = new Date(), j = d.getDay(), mois = d.getMonth() + 1;
  const m = await meteo(); if (!$("#cesoir")) return;
  const t = m?.t ?? (mois <= 2 || mois === 12 ? 5 : mois >= 6 && mois <= 8 ? 24 : 14);
  const weekend = j === 5 || j === 6, dimanche = j === 0;
  const notes = vins.map((v) => {
    const u = urgence(v), val = valU(v) ?? 15, c = v.couleur, pq = [];
    const dec = v.declin_debut ?? (v.apogee_fin ?? v.apogee_debut) + 1;
    let sc = { urgent: NOW - dec <= 3 ? 5 : 1.5, bientot: 4, apogee: 3, garder: -4, inconnu: 0 }[u];
    if (u === "urgent") pq.push(NOW - dec <= 3 ? `déclin dès ${dec} : c'est maintenant ou jamais` : `une vieille bouteille (déclin dès ${dec}) : à tenter par curiosité`);
    else if (u === "bientot") pq.push(`fin d'apogée en ${v.apogee_fin} : à ouvrir sans tarder`);
    else if (u === "apogee") pq.push(`à son apogée jusqu'en ${v.apogee_fin ?? v.apogee_debut}`);
    if (t <= 9) { if (c === "rouge") { sc += 2; pq.push(`${t} °C dehors : un rouge qui réchauffe`); } else if (c === "blanc" || c === "rose") sc -= 1; }
    else if (t >= 22) { if (["blanc", "rose", "effervescent"].includes(c)) { sc += 2; pq.push(`${t} °C : de la fraîcheur s'impose`); } else if (c === "rouge") sc -= 1.5; }
    if (weekend && c === "effervescent") { sc += 2.5; pq.push(`${j === 5 ? "vendredi" : "samedi"} soir : on sort les bulles`); }
    if (weekend && val >= 30) { sc += 1; pq.push("une belle bouteille pour le week-end"); }
    if (dimanche && c === "rouge" && val >= 20) { sc += 1; pq.push("parfait pour le dîner du dimanche"); }
    if (!weekend && !dimanche) { if (val <= 18) sc += 1; if (val >= 50) { sc -= 2.5; } }
    if (qte(v.id) >= 6) sc += 0.5;
    return { v, sc: sc + Math.random() * 1.6, pq };
  }).sort((a, b) => b.sc - a.sc);
  const pris = [], coul = new Set();
  for (const n of notes.slice(0, 15)) if (pris.length < 3 && !coul.has(n.v.couleur)) { pris.push(n); coul.add(n.v.couleur); }
  for (const n of notes) if (pris.length < 3 && !pris.includes(n)) pris.push(n);
  pris.sort((a, b) => b.sc - a.sc);
  const jour = d.toLocaleDateString("fr-FR", { weekday: "long" });
  z.innerHTML = `<div class="row" style="justify-content:space-between"><div><h2>Ce soir, on ouvre quoi ?</h2><div class="muted" style="font-size:13px">${esc(jour[0].toUpperCase() + jour.slice(1))}${m ? ` · ${m.t} °C à Paris, ${CIEL(m.code)}` : ""} · choisi selon l'apogée, la météo et le jour</div></div><button class="btn sm" id="cs-re">Autres idées</button></div>
    <div class="cs-grid">${pris.map(({ v, pq }) => { const b = enCave(v.id).find((x) => x.rangement_id) || enCave(v.id)[0];
      return `<div class="cs-item"><img src="${esc(pic(v))}" alt=""><div style="min-width:0"><a href="#vin-${v.id}" style="color:inherit;text-decoration:none"><b>${esc(v.domaine)}</b><div class="muted" style="font-size:13px">${esc([v.cuvee, v.appellation].filter(Boolean).join(" · "))} ${v.millesime ?? ""}</div></a>
      <div class="cs-why">${esc((pq[0] || "une valeur sûre de ta cave"))}${pq[1] ? `<br>${esc(pq[1])}` : ""}</div>
      <div class="row" style="gap:6px;margin-top:6px"><span class="pill ph-${(phase(v) || "").normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}">${COUL_LIB[v.couleur] ?? ""}</span><span class="muted" style="font-size:12px">${esc(b ? emplacementTxt(b) : "")}</span></div>
      ${b?.rangement_id ? `<button class="link" data-ou="${v.id}">Où est-elle ?</button>` : ""}</div></div>`; }).join("")}</div>`;
  $("#cs-re").onclick = () => ceSoir(vins);
  z.querySelectorAll("[data-ou]").forEach((x) => (x.onclick = () => voir3d(x.dataset.ou)));
}
/* ---------------- Horloge d'apogée ---------------- */
const URG_LIB = { urgent: "À boire d'urgence", bientot: "Fin d'apogée proche", apogee: "À leur sommet", garder: "À garder", inconnu: "Garde inconnue" };
const hex = (n) => "#" + n.toString(16).padStart(6, "0");
function horlogeApogee(vins) {
  const z = $("#horl"); if (!z) return;
  const g = { urgent: [], bientot: [], apogee: [], garder: [], inconnu: [] };
  vins.forEach((v) => g[urgence(v)].push(v));
  const nb = (k) => g[k].reduce((s, v) => s + qte(v.id), 0);
  const sel = S.ui.horl && g[S.ui.horl].length ? S.ui.horl : ["urgent", "bientot", "apogee", "garder"].find((k) => g[k].length) || "garder";
  const ete = new Date().getMonth() >= 5 ? NOW + 1 : NOW;
  const alerte = nb("urgent") + nb("bientot");
  const liste = g[sel].sort((a, b) => (a.apogee_fin ?? a.apogee_debut ?? 9999) - (b.apogee_fin ?? b.apogee_debut ?? 9999) || qte(b.id) - qte(a.id));
  z.innerHTML = `<div class="row" style="justify-content:space-between"><h2>Horloge d'apogée</h2><button class="link" id="h3d">Voir dans la cave 3D</button></div>
    ${alerte ? `<div class="h-alerte"><b>${alerte} bouteille${alerte > 1 ? "s" : ""}</b> à boire avant l'été ${ete}.</div>` : `<div class="muted">Aucune bouteille ne presse : ta cave est bien gardée.</div>`}
    <div class="h-cases">${["urgent", "bientot", "apogee", "garder"].map((k) => `<button data-h="${k}" aria-pressed="${k === sel}" style="--c:${hex(URGENCE[k])}"><span class="num">${nb(k)}</span><small>${URG_LIB[k]}</small></button>`).join("")}</div>
    ${horloge(liste)}${liste.length > 8 ? `<div class="muted" style="font-size:12px">et ${liste.length - 8} autre${liste.length > 9 ? "s" : ""} vin${liste.length > 9 ? "s" : ""}</div>` : ""}`;
  z.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => { S.ui.horl = b.dataset.h; horlogeApogee(vins); }));
  $("#h3d").onclick = () => { S.ui.urg3d = true; S.ui.voir3d = true; S.ui.mode = "3d"; if (location.hash === "#vins") route(); else location.hash = "#vins"; };
}
/* ---------------- Plus-values ---------------- */
function plusValues(vins) {
  const z = $("#pv"); if (!z) return;
  const ong = S.ui.pv || "pct";
  const avec = vins.filter((v) => v.prix_achat && valU(v)).map((v) => ({ v, pct: valU(v) / v.prix_achat - 1, eu: (valU(v) - v.prix_achat) * qte(v.id) }));
  const tot = avec.reduce((s, x) => s + x.eu, 0);
  const L = { pct: [...avec].sort((a, b) => b.pct - a.pct), eur: [...avec].sort((a, b) => b.eu - a.eu), tresor: vins.filter((v) => valU(v)).sort((a, b) => valU(b) - valU(a)).map((v) => ({ v })), moins: avec.filter((x) => x.eu < 0).sort((a, b) => a.eu - b.eu) }[ong].slice(0, 5);
  const val = (x) => ong === "tresor" ? [eur(valU(x.v)), "", `l'unité · ×${qte(x.v.id)}`] : ong === "pct" ? [`${x.pct >= 0 ? "+" : ""}${(x.pct * 100).toFixed(0)} %`, x.pct >= 0 ? "up" : "down", `${eur(x.v.prix_achat)} → ${eur(valU(x.v))}`] : [`${x.eu >= 0 ? "+" : ""}${eur(x.eu)}`, x.eu >= 0 ? "up" : "down", `×${qte(x.v.id)} · ${eur(x.v.prix_achat)} → ${eur(valU(x.v))}`];
  z.innerHTML = `<div class="pv-tete"><h2>Plus-values</h2>${avec.length ? `<div class="pv-tot"><span class="num ${tot >= 0 ? "up" : "down"}">${tot >= 0 ? "+" : ""}${eur(tot)}</span><small>latente · ${avec.length} vins</small></div>` : ""}</div>
    <div class="seg pv-seg" id="pvseg">${[["pct", "En %"], ["eur", "En €"], ["tresor", "Trésors"], ["moins", "Baisses"]].map(([k, l]) => `<button data-k="${k}" aria-pressed="${k === ong}">${l}</button>`).join("")}</div>
    <div class="pv-liste">${L.length ? L.map((x, i) => { const [a, c, sub] = val(x); return `<a href="#vin-${x.v.id}" class="pv-li"><span class="pv-rg">${i + 1}</span><span class="pv-nom"><b>${esc(x.v.domaine)}</b><small>${esc([x.v.appellation, x.v.millesime].filter(Boolean).join(" · "))}</small></span><span class="pv-val"><span class="num ${c}">${a}</span><small>${sub}</small></span></a>`; }).join("") : `<div class="muted" style="padding:8px 0">${ong === "moins" ? "Aucun vin ne vaut moins que son prix d'achat." : "Renseigne les prix d'achat et lance une réévaluation."}</div>`}</div>`;
  $("#pvseg").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.ui.pv = b.dataset.k; plusValues(vins); } };
}
function rechercheGlobale() {
  const inp = $("#qg"), box = $("#qgres"); if (!inp) return;
  let sel = -1;
  const surligne = (txt, mots) => { let h = esc(txt ?? ""); mots.forEach((m) => { const i = sansAccent(txt ?? "").indexOf(m); if (i >= 0) { const brut = String(txt).slice(i, i + m.length); h = h.replace(esc(brut), `<mark>${esc(brut)}</mark>`); } }); return h; };
  const fermer = () => { box.innerHTML = ""; sel = -1; };
  const marquer = () => box.querySelectorAll("button[data-id]").forEach((b, i) => { b.classList.toggle("on", i === sel); if (i === sel) b.scrollIntoView({ block: "nearest" }); });
  inp.oninput = () => {
    const mots = sansAccent(inp.value.trim()).split(/\s+/).filter(Boolean); sel = -1;
    if (!mots.length || inp.value.trim().length < 2) return fermer();
    const r = S.d.vins.map((v) => {
      const t = sansAccent([v.domaine, v.cuvee, v.appellation, v.region, v.pays, v.millesime, v.couleur, (Array.isArray(v.cepages) ? v.cepages : []).map((c) => c?.nom).join(" ")].join(" "));
      if (!mots.every((m) => t.includes(m))) return null;
      const d = sansAccent(v.domaine); return { v, s: (mots.some((m) => d.startsWith(m)) ? 2 : 0) + (qte(v.id) ? 1 : 0) };
    }).filter(Boolean).sort((a, b) => b.s - a.s);
    box.innerHTML = `<div class="results">${r.length ? `<div class="rhead">${r.length} vin${r.length > 1 ? "s" : ""}${r.length > 30 ? " · les 30 premiers" : ""}</div>` + r.slice(0, 30).map(({ v }) => `<button data-id="${v.id}"><img class="thumb" src="${esc(pic(v))}" alt=""><span><b>${surligne(v.domaine, mots)}</b> ${surligne(v.cuvee, mots)} ${v.millesime ?? ""}<br><span class="muted" style="font-size:12px">${surligne(v.appellation ?? v.region, mots)} · ${qte(v.id) ? qte(v.id) + " en cave" : "plus en cave"}</span></span></button>`).join("") : `<div class="muted" style="padding:12px">Aucun vin trouvé. <a href="#scan">Ajouter une bouteille</a></div>`}</div>`;
    box.querySelectorAll("button[data-id]").forEach((b) => (b.onclick = () => go("vin-" + b.dataset.id)));
  };
  inp.onkeydown = (e) => {
    const n = box.querySelectorAll("button[data-id]").length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); sel = (sel + 1) % n; marquer(); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); sel = (sel - 1 + n) % n; marquer(); }
    else if (e.key === "Enter" && n) { e.preventDefault(); box.querySelectorAll("button[data-id]")[Math.max(0, sel)].click(); }
    else if (e.key === "Escape") { fermer(); inp.blur(); }
  };
  inp.onfocus = () => { if (inp.value.trim().length >= 2 && !box.innerHTML) inp.oninput(); };
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest?.("#qgres") && e.target !== inp) fermer(); });
}

/* ---------------- Valorisation ---------------- */
async function reevaluer(v, silencieux = false) {
  let wid = v.wineapi_id;
  if (!wid) {
    const r = await callFn("vin", { action: "search", q: `${v.domaine} ${v.cuvee ?? ""} ${v.millesime ?? ""}`.trim() });
    const hit = (r?.results || []).find((x) => !v.millesime || x.vintage === v.millesime) || r?.results?.[0];
    if (!hit) { if (!silencieux) toast("Vin introuvable sur wineapi.io : ajoute une cote manuelle."); return false; }
    wid = hit.id; await q(sb.from(T("vins")).update({ wineapi_id: wid }).eq("id", v.id));
  }
  const r = await callFn("vin", { action: "prix", id: wid });
  const prix = (r?.prices || []).filter((p) => p.price != null && !isNaN(+p.price));
  if (!prix.length) { if (!silencieux) toast("Aucun prix disponible pour ce vin."); return false; }
  const rows = prix.map((p) => ({ vin_id: v.id, source: "wineapi.io", detail: p.merchantName || null, prix: +p.price, devise: p.currency || "EUR", url: p.url || null, releve_le: new Date().toISOString() }));
  await q(sb.from(T("prix")).insert(rows));
  const eurs = rows.filter((x) => x.devise === "EUR").map((x) => x.prix);
  const manuel = S.d.prix.filter((p) => p.vin_id === v.id && p.source !== "wineapi.io").slice(-3).map((p) => +p.prix);
  const m = median([...eurs, ...manuel]);
  if (m != null) {
    await q(sb.from(T("vins")).update({ valeur_unitaire: m, valeur_maj: new Date().toISOString(), valeur_sources: rows.slice(0, 8).map((x) => ({ source: x.source, detail: x.detail, prix: x.prix, devise: x.devise, url: x.url })) }).eq("id", v.id));
    await journal("reevaluation", v, 0, `Valeur unitaire ${eur(v.valeur_unitaire)} → ${eur(m)} (médiane de ${eurs.length + manuel.length} sources)`, m);
  }
  return true;
}
async function reevaluerTout() {
  const vins = vinsEnCave(); let ok = 0; toast(`Réévaluation de ${vins.length} vins…`);
  const rates = []; for (const v of vins) { try { if (await reevaluer(v, true)) ok++; else if (valU(v) == null || String(v.valeur_sources?.[0]?.source).startsWith("Estimation") || v.valeur_sources?.[0]?.auto) rates.push(v); } catch (e) { console.warn(e); } await pause(350); }
  let est = 0; if (rates.length) { try { est = await estimerClaude(rates); } catch (e) { console.warn(e); } }
  toast(`${ok} vin${ok > 1 ? "s" : ""} réévalué${ok > 1 ? "s" : ""}${est ? `, ${est} estimé${est > 1 ? "s" : ""}` : ""} sur ${vins.length}.`); refresh();
}

// Quand wineapi.io n'a aucun prix : estimation de la valeur de marché par Claude (affichée comme « Estimation »)
async function estimerClaude(vins) {
  let ok = 0;
  for (let i = 0; i < vins.length; i += 40) {
    const lot = vins.slice(i, i + 40);
    const r = await callFn("cote", { vins: lot.map((v) => [v.id, v.domaine, v.cuvee, v.millesime, v.appellation ?? v.region, v.couleur, v.conditionnement || "75 cl"].map((x) => x ?? "").join(" | ")) });
    for (const c of r?.cotes || []) {
      const v = lot.find((x) => x.id === c.id), prix = Math.round(+c.prix * 100) / 100; if (!v || !(prix > 0)) continue;
      const src = c.source || "Estimation Claude", web = (c.sources || []).filter((s) => s.prix > 0);
      const detail = `${c.note || "Estimation"} · fourchette ${eur(c.min)} – ${eur(c.max)} · confiance ${c.confiance || "moyenne"}`.slice(0, 300);
      await q(sb.from(T("prix")).insert({ vin_id: v.id, source: src, detail, prix, devise: "EUR", releve_le: new Date().toISOString() }));
      const vs = web.length ? web.slice(0, 5).map((s) => ({ source: s.site, detail: "Caviste en ligne", prix: s.prix, devise: "EUR", url: s.url, auto: true })) : [{ source: src, detail, prix, devise: "EUR" }];
      await q(sb.from(T("vins")).update({ valeur_unitaire: prix, valeur_maj: new Date().toISOString(), valeur_sources: vs }).eq("id", v.id));
      await journal("reevaluation", v, 0, web.length ? `Cote ${eur(prix)} relevée chez ${web.length} caviste${web.length > 1 ? "s" : ""} en ligne` : `Estimation ${eur(prix)} (wineapi.io sans prix pour ce vin)`, prix); ok++;
    }
  }
  return ok;
}
// Cote automatique des vins en cave sans valeur (après un import, ou à l'ouverture) : wineapi.io d'abord, sinon estimation
async function revalImport(ids = null) {
  let essayes = []; try { essayes = JSON.parse(lsGet("reval-tente2") || "[]"); } catch {}
  const vins = (ids ? S.d.vins.filter((v) => ids.includes(v.id)) : S.d.vins.filter((v) => !v.valeur_maj && valU(v) == null && qte(v.id) > 0)).filter((v) => !essayes.includes(v.id));
  if (!vins.length || S.demo || S.revalEnCours) return;
  S.revalEnCours = true; lsSet("reval-tente2", JSON.stringify([...essayes, ...vins.map((v) => v.id)].slice(-2000)));
  toast(`Recherche de la cote de ${vins.length} vin${vins.length > 1 ? "s" : ""}…`);
  const rates = [];
  let ok = 0; for (const v of vins) { try { if (await reevaluer(v, true)) ok++; else rates.push(v); } catch (e) { console.warn(e); rates.push(v); } await pause(350); }
  let est = 0; if (rates.length) { try { est = await estimerClaude(rates); } catch (e) { console.warn(e); } }
  S.revalEnCours = false;
  toast(`${ok ? `Cote trouvée pour ${ok} vin${ok > 1 ? "s" : ""}. ` : ""}${est ? `${est} estimation${est > 1 ? "s" : ""} pour les vins sans cote publiée.` : ""}`.trim() || "Aucune cote trouvée : ajoutez une cote depuis la fiche du vin."); refresh();
}

/* ---------------- Mes vins ---------------- */
function vVins() {
  const caves = S.d.caves; if (!S.ui.cave || !caves.find((c) => c.id === S.ui.cave)) S.ui.cave = caves[0]?.id ?? null;
  const cave = caves.find((c) => c.id === S.ui.cave);
  const rgs = S.d.rangements.filter((r) => r.cave_id === S.ui.cave).sort((a, b) => a.ordre - b.ordre);
  const nonRangees = S.d.bouteilles.filter((b) => b.statut === "en_cave" && !b.rangement_id).length;
  const places = (c) => { const r = S.d.rangements.filter((x) => x.cave_id === c.id); const cap = r.reduce((s, x) => s + capRg(x), 0); const occ = S.d.bouteilles.filter((b) => b.statut === "en_cave" && r.some((x) => x.id === b.rangement_id)).length; return [occ, cap]; };
  $("#view").innerHTML = `<div class="head"><div><div class="eyebrow">${caves.length} cave${caves.length > 1 ? "s" : ""} · ${vinsEnCave().reduce((s, v) => s + qte(v.id), 0)} bouteilles</div><h1>Mes vins</h1></div><div class="row"><button class="btn" data-act="excel">Importer un fichier Excel</button><a class="btn primary" href="#scan">Ajouter une bouteille</a></div></div>
    <div class="cellars">${caves.map((c, i) => { const [o, cap] = places(c); return `<button class="cellar" data-cave="${c.id}" aria-pressed="${c.id === S.ui.cave}"><img src="${i % 2 ? "img/champagne.jpg" : "img/hero.jpg"}" alt=""><b>${esc(c.nom)}</b><div class="muted" style="font-size:12px">${esc(c.lieu ?? "")}${c.temperature ? " · " + c.temperature + " °C" : ""}</div><div class="num" style="margin-top:6px">${o}${cap ? "/" + cap : ""} <span class="muted">places</span></div></button>`; }).join("")}
      <button class="cellar" id="newcave"><b>+ Nouvelle cave</b><div class="muted" style="font-size:12px">Casiers, étagères, armoire, vrac</div></button></div>
    <div class="row" style="justify-content:space-between"><div class="seg" id="mode">${[["3d", "3D"], ["plan", "Plan"], ["murs", "Murs"], ["casier", "Casiers"], ["liste", "Liste"]].map((m) => `<button data-m="${m[0]}" aria-pressed="${S.ui.mode === m[0]}">${m[1]}</button>`).join("")}</div>${cave ? `<span class="row" style="gap:8px"><button class="btn sm" id="addrg2">+ Ajouter un rangement</button><button class="btn sm" id="modcave" title="Nom, type, fond, photos ou suppression">Modifier la cave</button></span>` : ""}
      <div class="row coulf" id="coulf">${Object.keys(COUL_LIB).slice(0, 5).filter((k) => vinsEnCave().some((v) => v.couleur === k)).map((k) => `<button class="chip" data-coul="${k}" aria-pressed="${S.ui.couleur === k}"><b style="background:${COL[k]}"></b>${COUL_LIB[k]}<small class="num">${vinsEnCave().filter((v) => v.couleur === k).reduce((n, v) => n + qte(v.id), 0)}</small></button>`).join("")}</div></div>
    <div id="zone"></div>`;
  document.querySelectorAll("[data-cave]").forEach((b) => (b.onclick = () => { S.ui.cave = b.dataset.cave; vVins(); }));
  $("#coulf").onclick = (e) => {
    const b = e.target.closest("[data-coul]"); if (!b) return;
    S.ui.couleur = S.ui.couleur === b.dataset.coul ? "" : b.dataset.coul;
    document.querySelectorAll("[data-coul]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.coul === S.ui.couleur));
    if (S.ui.mode === "3d" && S.vue3d) { const n = S.vue3d.filtre(S.ui.couleur || null); if (S.ui.couleur) toast(`${n} bouteille${n > 1 ? "s" : ""} ${COUL_LIB[S.ui.couleur].toLowerCase()}${n > 1 ? "s" : ""} en évidence.`); }
    else if (S.ui.mode === "liste") vListe($("#zone"));
  };
  $("#newcave").onclick = () => (S.demo ? etapeCreation() : formCave());
  if ($("#addrg2")) $("#addrg2").onclick = () => (S.demo ? toast("Cave de démonstration : créez votre cave pour la modifier.") : formRangement(cave.id));
  if ($("#modcave")) $("#modcave").onclick = () => (S.demo ? toast("Cave de démonstration : créez votre cave pour la modifier.") : formCave(cave));
  $("#mode").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.ui.mode = b.dataset.m; vVins(); } };
  const z = $("#zone");
  if (S.vue3d) { S.vue3d.dispose(); S.vue3d = null; }
  if (S.ui.mode === "liste") return vListe(z);
  if (cave && S.ui.mode === "3d") return v3D(z, cave);
  if (cave && S.ui.mode === "plan") return vPlan(z, cave);
  if (cave && S.ui.mode === "murs") return vMurs(z, cave);
  if (!cave) { z.innerHTML = `<section class="card empty"><h2>Crée ta première cave</h2><p class="muted" style="margin:0">Donne-lui un nom, puis ajoute ses casiers et étagères.</p><button class="btn primary" id="nc2">Créer une cave</button></section>`; $("#nc2").onclick = () => formCave(); return; }
  z.innerHTML = `<div class="grid"><div class="c8 stack" style="gap:16px" id="racks"></div>
    <section class="card c4"><div class="row" style="justify-content:space-between"><h2>${esc(cave.nom)}</h2><button class="btn sm" id="editcave">Modifier</button></div>
      ${rgs.map((r) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:8px"><span><b>${esc(r.nom)}</b><br><span class="muted" style="font-size:12px">${TYPES_RG[r.type]}${["caisse", "vrac"].includes(r.type) ? "" : ` · ${r.lignes} × ${r.colonnes}${profRg(r) > 1 ? " × 2 en profondeur" : ""}`}</span></span><span class="num">${S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id).length}${["caisse", "vrac"].includes(r.type) ? "" : "/" + capRg(r)}</span></div>`).join("") || `<div class="muted">Aucun rangement pour l'instant.</div>`}
      <button class="btn" id="addrg">+ Ajouter un rangement</button>
      ${nonRangees ? `<div class="banner"><span>${nonRangees} bouteille${nonRangees > 1 ? "s" : ""} non rangée${nonRangees > 1 ? "s" : ""}</span><span class="row" style="gap:8px"><span class="muted" style="font-size:12px">Clique une place libre pour ranger</span>${cave ? `<button class="btn sm" data-act="hasard">Ranger au hasard</button>` : ""}</span></div>` : ""}
      <div class="note">Clique une bouteille pour ouvrir sa fiche, ou une place libre pour y ranger un vin.</div></section></div>`;
  $("#addrg").onclick = () => formRangement(cave.id);
  $("#editcave").onclick = () => formCave(cave);
  if (rgs.some((r) => r.mur)) { $("#racks").innerHTML = `<section class="card" id="vmurs"></section>`; return vCasiersMur(cave, rgs); }
  $("#racks").innerHTML = rgs.map((r) => `<section class="card"><div class="rgtitle"><h2>${esc(r.nom)}</h2><span class="row"><span class="muted">${TYPES_RG[r.type]}</span><button class="btn sm" data-editrg="${r.id}">Modifier</button></span></div>${casier(r)}</section>`).join("") || `<section class="card empty"><h2>Ajoute un rangement</h2><p class="muted" style="margin:0">Grille, casier losange, étagères, caisse ou vrac, avec ta propre numérotation.</p></section>`;
  document.querySelectorAll("[data-editrg]").forEach((b) => (b.onclick = () => formRangement(cave.id, S.d.rangements.find((r) => r.id === b.dataset.editrg))));
  document.querySelectorAll("[data-slot]").forEach((b) => (b.onclick = () => { const [rid, l, c] = b.dataset.slot.split("|"); rangerIci(rid, +l, +c); }));
}
/* ---------------- Vue Casiers : chaque mur de face, casiers dessinés comme en vrai, bouteilles dedans ---------------- */
function vCasiersMur(cave, rgs) {
  const z = $("#vmurs"), plan = cave.plan || {}, POS = positions(plan, rgs);
  const murs = ["O", "N", "E", "S"].filter((m) => rgs.some((r) => (r.mur || "N") === m));
  if (!murs.includes(S.ui.murCas)) S.ui.murCas = murs.includes("E") ? "E" : murs[0];
  const m = S.ui.murCas, liste = rgs.filter((r) => (r.mur || "N") === m);
  const cm = (v) => +(v * 100).toFixed(1);
  const W = Math.max(...liste.map((r) => POS[r.id].x + (+r.largeur_m || 0.5))), Ht = Math.max(...liste.map((r) => POS[r.id].y + (+r.hauteur_m || 0.5)));
  const pad = 6, VW = cm(W) + 2 * pad, VH = cm(Ht) + 2 * pad + 6;
  let svg = "";
  for (const r of liste) {
    const w = +r.largeur_m || 0.5, h = +r.hauteur_m || 0.5, forme = r.forme || (r.type === "losange" ? "losange" : ["vrac", "caisse"].includes(r.type) ? "vrac" : "grille");
    const ox = pad + cm(POS[r.id].x + w / 2), oy = pad + cm(Ht - POS[r.id].y - h / 2);
    const g = geometrie(forme, w, h), bs = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id), pl = placer(r, g.slots, bs);
    const X = (x) => +(ox + x * 100).toFixed(1), Y = (y) => +(oy - y * 100).toFixed(1);
    const occ = new Set(pl.map((p) => p.k));
    svg += `<g class="cm-c"><rect x="${X(-w / 2)}" y="${Y(h / 2)}" width="${cm(w)}" height="${cm(h)}" class="cm-cadre"/><rect x="${X(-g.iw / 2)}" y="${Y(g.ih / 2)}" width="${cm(g.iw)}" height="${cm(g.ih)}" class="cm-fond"/>`;
    svg += g.traits.map((t) => `<line x1="${X(t.x1)}" y1="${Y(t.y1)}" x2="${X(t.x2)}" y2="${Y(t.y2)}" class="cm-latte" style="stroke-width:${cm(t.e)}"/>`).join("");
    // places libres (cliquables pour ranger)
    svg += g.slots.map((sl, k) => occ.has(k) ? "" : `<circle cx="${X(sl.x)}" cy="${Y(sl.y)}" r="3.2" class="cm-libre" data-cslot="${r.id}|${sl.l || 0}|${sl.c || 0}"><title>Place libre · ${esc(r.nom)}</title></circle>`).join("");
    svg += pl.map(({ b, s: sl, tour }) => { const v = S.d.vins.find((x) => x.id === b.vin_id); const x = X(sl.x + (tour ? (tour % 2 ? 0.018 : -0.018) : 0)), y = Y(sl.y + (tour ? 0.01 : 0));
      return `<a href="#vin-${v?.id ?? ""}" class="cm-b"><circle cx="${x}" cy="${y}" r="3.6" style="fill:${COL[v?.couleur] || COL.autre}"/><circle cx="${x}" cy="${y}" r="1.5" class="cm-caps"/><title>${esc(v ? nomVin(v) : "?")} · ${esc(r.nom)}</title></a>`; }).join("");
    svg += `<g class="cm-tag"><rect x="${X(-w / 2) + 2}" y="${Y(-h / 2) - 7}" width="${Math.max(12, r.nom.replace(/^Casier\s*/i, "").length * 3.2 + 5)}" height="5.6" rx="1"/><text x="${X(-w / 2) + 4.5}" y="${Y(-h / 2) - 2.9}">${esc(r.nom.replace(/^Casier\s*/i, ""))}</text></g>`;
    svg += `<rect x="${X(-w / 2)}" y="${Y(h / 2)}" width="${cm(w)}" height="${cm(h)}" class="cm-zone" data-crg="${r.id}"><title>${esc(r.nom)} · ${bs.length} bouteille${bs.length > 1 ? "s" : ""}</title></rect></g>`;
  }
  const nb = S.d.bouteilles.filter((b) => b.statut === "en_cave" && liste.some((r) => r.id === b.rangement_id)).length;
  z.innerHTML = `<div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="seg" id="cmurs">${murs.map((k) => `<button data-cm="${k}" aria-pressed="${k === m}">${MUR_COURT[k]}${lettreMur(rgs, k)}</button>`).join("")}</div><span class="muted">${liste.length} casiers · ${nb} bouteilles</span></div>
    <div class="cm-wrap"><svg viewBox="0 0 ${VW} ${VH}" class="cm-svg" style="--mw:${Math.round(VW * 2.6)}px" role="img" aria-label="Mur ${esc(MUR_COURT[m])}, vu de face"><rect x="0" y="${VH - 6}" width="${VW}" height="6" class="cm-sol"/>${svg}</svg></div>
    <div class="note">Vu de face, depuis l'intérieur de la cave. Touche une bouteille pour ouvrir sa fiche, une place vide (cercle pointillé) pour y ranger un vin.</div>`;
  z.querySelectorAll("[data-cm]").forEach((b) => (b.onclick = () => { S.ui.murCas = b.dataset.cm; vCasiersMur(cave, rgs); }));
  z.querySelectorAll("[data-cslot]").forEach((c) => (c.onclick = (e) => { e.stopPropagation(); const [rid, l, cc] = c.dataset.cslot.split("|"); rangerIci(rid, +l || null, +cc || null); }));
}
/* ---------------- 3D et plan ---------------- */
const PLAN_DEF = { largeur: 3, longueur: 4, hauteur: 2.4, module: 0.5 };
// Fonds illustrés (images générées, dans img/fonds/) : par région, ou domaine et chai
const FONDS_IMG = { "r-bordeaux": "Bordeaux", "r-bourgogne": "Bourgogne", "r-champagne": "Champagne", "r-rhone": "Vallée du Rhône", "r-loire": "Loire", "r-alsace": "Alsace", "r-provence": "Provence", "r-languedoc": "Languedoc", "r-toscane": "Toscane", "d-domaine": "Le domaine", "d-chai": "Chai à barriques", "d-vendanges": "Pressoir et vendanges" };
function grilleFonds(sel) {
  const pt = (k, nom, vis) => `<button type="button" class="fond-pt" data-fond="${k}" aria-pressed="${sel === k}" title="${esc(nom)}">${vis}${esc(nom)}</button>`;
  const img = (k) => `<i style="background:url(img/fonds/${k}-min.jpg) center/cover"></i>`;
  const grp = (t, html) => `<div class="fonds-g"><small>${t}</small><div class="fonds">${html}</div></div>`;
  const ks = Object.keys(FONDS_IMG);
  return grp("Automatique", pt("auto", "Selon mes vins", `<i class="fond-auto"></i>`))
    + grp("Régions viticoles", ks.filter((k) => k[0] === "r").map((k) => pt(k, FONDS_IMG[k], img(k))).join(""))
    + grp("Domaine et chai", ks.filter((k) => k[0] === "d").map((k) => pt(k, FONDS_IMG[k], img(k))).join(""))
    + grp("Couleurs unies", Object.entries(FONDS_CAVE).map(([k, [nom, mur, accent]]) => pt(k, nom, `<i style="background:linear-gradient(135deg,${mur} 0 62%,${accent} 62%)"></i>`)).join(""));
}
const STYLES_CAVE = { piece: "Pièce (cellier, sous-sol)", pierre: "Cave voûtée en pierre", armoire: "Cave électrique (armoire)" };
const PLAN_TYPE = { piece: PLAN_DEF, pierre: { largeur: 2.8, longueur: 3.4, hauteur: 2.0, module: 0.5 }, armoire: { largeur: 0.6, longueur: 0.6, hauteur: 1.3, module: 0.5 } };
const FONDS_CAVE = { lin: ["Lin", "#ece9e3", "#6e1a2c"], bordeaux: ["Bordeaux", "#6b1a2e", "#c9a227"], nuit: ["Bleu nuit", "#243556", "#d8b56a"], sauge: ["Vert sauge", "#9bb39a", "#6b3f22"], terracotta: ["Terracotta", "#c4683f", "#33241b"], ardoise: ["Ardoise", "#3c4149", "#c49a3a"], champagne: ["Champagne", "#e8d39c", "#7b1e3a"], lavande: ["Lavande", "#b3a2d4", "#4a2a6e"] };
const MUR_COURT = { O: "Gauche", N: "Fond", E: "Droite", S: "Porte" };
const lettreMur = (rgs, k) => { const l = [...new Set(rgs.filter((r) => (r.mur || "N") === k).map((r) => (r.nom.match(/[A-Z]\s*$/i) || [""])[0].trim().toUpperCase()).filter(Boolean))]; return l.length ? " · " + l.join("") : ""; };
async function v3D(z, cave) {
  const rgs = S.d.rangements.filter((r) => r.cave_id === cave.id).sort((a, b) => a.ordre - b.ordre);
  z.innerHTML = `<section class="card scene3d"><div class="s3d-wrap"><div class="s3d" id="s3d"><div class="s3d-load"><span class="spin"></span> Construction de la cave…</div></div><div id="carte3d"></div></div>
    <div class="s3d-tools"><label class="s3d-sel"><span>Vue</span><select id="s3dvue"><option value="gen">Entrée</option>${["O", "N", "E", "S"].filter((k) => rgs.some((r) => (r.mur || "N") === k)).map((k) => `<option value="${k}">${MUR_COURT[k]}${lettreMur(rgs, k)}</option>`).join("")}</select></label>
      <label class="s3d-sel"><span>Casier</span><select id="s3dcas"><option value="">Choisir…</option>${["O", "N", "E", "S"].filter((k) => rgs.some((r) => (r.mur || "N") === k)).map((k) => `<optgroup label="${MUR_COURT[k]}">${rgs.filter((r) => (r.mur || "N") === k).sort((a, b) => a.nom.localeCompare(b.nom, "fr", { numeric: true })).map((r) => `<option value="${r.id}">${esc(r.nom.replace(/^Casier\s*/i, ""))} · ${S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id).length} btl</option>`).join("")}</optgroup>`).join("")}</select></label><span style="flex:1"></span><button class="btn sm" data-v="urg" id="s3durg" aria-pressed="${!!S.ui.urg3d}">Urgence à boire</button><button class="btn sm" data-v="ret" id="s3dret" hidden>← Retour</button></div>
    <div class="leg3d" id="leg3d" ${S.ui.urg3d ? "" : "hidden"}>${["urgent", "bientot", "apogee", "garder", "inconnu"].map((k) => `<span class="chip"><b style="background:${hex(URGENCE[k])}"></b>${URG_LIB[k]}</span>`).join("")}</div>
    <div class="note">Choisis un mur, touche un casier pour t'en approcher, puis une bouteille : elle sort du casier avec sa fiche. Glisse pour regarder autour, pince pour zoomer.${cave.plan ? "" : " Place tes casiers dans l'onglet « Murs »."}</div></section>`;
  if (!rgs.length) { $("#s3d").innerHTML = `<div class="s3d-load">Ajoute des rangements pour voir ta cave en 3D.</div>`; return; }
  let mod;
  try { mod = await import("./cave3d.js?v=27"); } catch (e) { $("#s3d").innerHTML = `<div class="s3d-load">3D indisponible sur cet appareil.</div>`; return; }
  if (S.ui.mode !== "3d" || !$("#s3d")) return;
  $("#s3d").innerHTML = "";
  const chip = (rid) => { const c = $("#s3dcas"); if (c) c.value = rid || ""; };
  S.vue3d = mod.monter($("#s3d"), {
    cave: { ...cave, plan: cave.plan || PLAN_DEF }, rangements: rgs.map((r, i) => (r.mur ? r : { ...r, mur: "N", plan_col: i % 5, plan_niv: Math.floor(i / 5) })),
    bouteilles: S.d.bouteilles, vins: S.d.vins, sombre: matchMedia("(prefers-color-scheme: dark)").matches,
    onModule: (r) => { chip(r.id); $("#carte3d").innerHTML = ""; $("#s3dret").hidden = false; },
    onBottle: (b, v) => carte3d(b, v),
  });
  if (S.ui.urg3d) S.vue3d.couleurs("urgence");
  if (S.ui.couleur) S.vue3d.filtre(S.ui.couleur);
  if (S.ui.voir3d) { S.ui.voir3d = false; document.querySelector(".scene3d").scrollIntoView({ block: "start", behavior: "smooth" }); }
  if (S.ui.trouver) {
    const t = S.ui.trouver; S.ui.trouver = null;
    const ids = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.vin_id === t.vin).map((b) => b.id);
    const n = S.vue3d.surligner(ids, t.b);
    const b = S.d.bouteilles.find((x) => x.id === t.b), v = S.d.vins.find((x) => x.id === t.vin);
    document.querySelector(".scene3d").scrollIntoView({ block: "start", behavior: "smooth" });
    if (b && v && n) { chip(b.rangement_id); carte3d(b, v); toast(`${n} bouteille${n > 1 ? "s" : ""} de ce vin en surbrillance.`); }
  }
  document.querySelector(".s3d-tools").onclick = (e) => {
    const v = e.target.closest("[data-v]")?.dataset.v; if (!v || !S.vue3d) return;
    if (v === "urg") { S.ui.urg3d = !S.ui.urg3d; S.vue3d.couleurs(S.ui.urg3d ? "urgence" : "vin"); $("#s3durg").setAttribute("aria-pressed", S.ui.urg3d); $("#leg3d").hidden = !S.ui.urg3d; return; }
    $("#carte3d").innerHTML = ""; chip(null);
    if (v === "gen") S.vue3d.vueGenerale(); else if (v === "ret") S.vue3d.retour(); else S.vue3d.murs(v);
    $("#s3dret").hidden = true;
  };
  $("#s3dvue").onchange = (e) => { const v = e.target.value; $("#carte3d").innerHTML = ""; chip(null); if (v === "gen") S.vue3d.vueGenerale(); else S.vue3d.murs(v); $("#s3dret").hidden = true; };
  $("#s3dcas").onchange = (e) => { const rid = e.target.value; if (!rid) return; S.vue3d.rentrer(); S.vue3d.focus(rid); $("#carte3d").innerHTML = ""; $("#s3dret").hidden = false; };
}
function carte3d(b, v) {
  if (!v) return;
  const ph = phase(v), n = qte(v.id);
  $("#carte3d").innerHTML = `<div class="carte3d"><button class="x" aria-label="Fermer" id="c3x">×</button>
    <div class="muted" style="font-size:12px">${esc([v.pays, v.region, v.appellation].filter(Boolean).join(" · "))}</div>
    <div class="row" style="justify-content:space-between;align-items:flex-start"><div><b style="font-size:17px">${esc(v.domaine)}</b>${v.cuvee ? `<div>${esc(v.cuvee)}</div>` : ""}</div>${ph ? `<span class="pill ph-${ph.normalize("NFD").replace(/[^a-z]/gi, "").toLowerCase()}">${ph}</span>` : ""}</div>
    <div class="muted" style="font-size:13px">${v.millesime ?? "Sans année"} · ${n} bouteille${n > 1 ? "s" : ""} · ${esc(v.conditionnement ?? "")} · ${esc(emplacementTxt(b))}</div>
    <div class="muted" style="font-size:13px">Valeur ${eur(valU(v))}${v.prix_achat ? ` · achat ${eur(v.prix_achat)}` : ""}</div>
    ${v.apogee_debut ? `<div class="muted" style="font-size:13px">À boire ${v.apogee_debut}${v.apogee_fin && v.apogee_fin !== v.apogee_debut ? "–" + v.apogee_fin : ""}${v.declin_debut ? ` · déclin dès ${v.declin_debut}` : ""}</div>` : ""}
    <div class="row" style="margin-top:8px"><button class="btn sm" id="c3d">Déplacer</button><button class="btn sm" id="c3s">Sortir</button><a class="btn sm primary" href="#vin-${v.id}">Fiche du vin</a></div></div>`;
  $("#c3x").onclick = () => { $("#carte3d").innerHTML = ""; S.vue3d?.rentrer(); };
  $("#s3dret") && ($("#s3dret").hidden = false);
  $("#c3d").onclick = () => deplacer(b);
  $("#c3s").onclick = () => sortir(v);
}
function vPlan(z, cave) {
  const plan = cave.plan || PLAN_DEF, W = plan.largeur, L = plan.longueur, M = plan.module || 0.5, P = 0.36;
  const rgs = S.d.rangements.filter((r) => r.cave_id === cave.id).map((r, i) => (r.mur ? r : { ...r, mur: "N", plan_col: i % 5, plan_niv: Math.floor(i / 5) }));
  const sc = 100, pad = 40, vw = W * sc + pad * 2, vh = L * sc + pad * 2;
  const X = (x) => pad + x * sc, Y = (zz) => pad + (L - zz) * sc; // nord en haut
  let rects = "";
  const occ = (r) => S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id).length;
  const POS = positions(plan, rgs), piles = {};
  rgs.forEach((r) => { const w = +r.largeur_m || M; (piles[`${r.mur}|${POS[r.id].x.toFixed(2)}|${w}`] ??= []).push(r); });
  for (const [k, pile] of Object.entries(piles)) {
    const [mur, le0, w0] = k.split("|"), le = +le0, w = +w0;
    let x, y, rw, rh;
    if (mur === "N") { x = X(le); y = Y(L); rw = w * sc; rh = P * sc; }
    else if (mur === "S") { x = X(W - le - w); y = Y(P); rw = w * sc; rh = P * sc; }
    else if (mur === "E") { x = X(W - P); y = Y(L - le); rw = P * sc; rh = w * sc; }
    else { x = X(0); y = Y(le + w); rw = P * sc; rh = w * sc; }
    const n = pile.reduce((s, r) => s + occ(r), 0), cap = pile.reduce((s, r) => s + capRg(r), 0);
    const noms = pile.sort((a, b) => POS[b.id].y - POS[a.id].y).map((r) => r.nom.replace(/^Casier\s*/i, ""));
    rects += `<g class="pl-mod" data-rids="${pile.map((r) => r.id).join(",")}"><rect x="${x + 1}" y="${y + 1}" width="${rw - 2}" height="${rh - 2}" rx="3" style="fill:color-mix(in srgb, var(--wine) ${Math.round(15 + 60 * Math.min(1, n / Math.max(1, cap)))}%, var(--surface))"/>
      <text x="${x + rw / 2}" y="${y + rh / 2}" text-anchor="middle" dominant-baseline="middle" class="pl-t"${mur === "E" || mur === "O" ? ` transform="rotate(-90 ${x + rw / 2} ${y + rh / 2})"` : ""}>${noms.length > 2 ? noms[0] + "–" + noms[noms.length - 1] : noms.join(" / ")}</text><title>${noms.join(", ")} · ${n} bouteilles</title></g>`;
  }
  const p = plan.porte;
  const porte = p ? `<rect x="${X(p.debut)}" y="${Y(0) - 3}" width="${p.largeur * sc}" height="6" class="pl-porte"/><path d="M${X(p.debut)} ${Y(0)} A ${p.largeur * sc} ${p.largeur * sc} 0 0 1 ${X(p.debut + p.largeur)} ${Y(0) + p.largeur * sc * 0}" class="pl-arc"/><text x="${X(p.debut + p.largeur / 2)}" y="${Y(0) + 18}" text-anchor="middle" class="pl-s">Porte</text>` : "";
  z.innerHTML = `<section class="card"><h2>Plan de ${esc(cave.nom)}</h2><div class="muted" style="font-size:13px">${W} × ${L} m · vue de dessus, porte en bas · couleur = remplissage</div>
    <svg viewBox="0 0 ${vw} ${vh + 20}" class="plan2d" role="img" aria-label="Plan de la cave"><rect x="${X(0)}" y="${Y(L)}" width="${W * sc}" height="${L * sc}" class="pl-piece"/>${rects}${porte}
    <text x="${X(W / 2)}" y="${Y(L) - 12}" text-anchor="middle" class="pl-s">${esc(plan.murs?.N ?? "Fond")}</text>
    <text x="${X(0) - 12}" y="${Y(L / 2)}" text-anchor="middle" class="pl-s" transform="rotate(-90 ${X(0) - 12} ${Y(L / 2)})">${esc(plan.murs?.O ?? "Gauche")}</text>
    <text x="${X(W) + 12}" y="${Y(L / 2)}" text-anchor="middle" class="pl-s" transform="rotate(90 ${X(W) + 12} ${Y(L / 2)})">${esc(plan.murs?.E ?? "Droite")}</text></svg>
    <div class="note">Touche un emplacement pour voir ses casiers. ${esc(plan.source ?? "")}</div><div id="plcas"></div></section>`;
  document.querySelectorAll(".pl-mod").forEach((g) => (g.onclick = () => {
    const ids = g.dataset.rids.split(",");
    $("#plcas").innerHTML = ids.map((id) => { const r = S.d.rangements.find((x) => x.id === id); return `<div class="rgtitle"><h2>${esc(r.nom)}</h2><span class="row"><span class="muted">${FORMES[r.forme] ?? TYPES_RG[r.type]}</span><button class="btn sm" data-editrg="${r.id}">Modifier</button></span></div>${casier(r)}`; }).join("");
    document.querySelectorAll("#plcas [data-editrg]").forEach((b) => (b.onclick = () => formRangement(cave.id, S.d.rangements.find((r) => r.id === b.dataset.editrg))));
    document.querySelectorAll("#plcas [data-slot]").forEach((b) => (b.onclick = () => { const [rid, l, c] = b.dataset.slot.split("|"); rangerIci(rid, +l, +c); }));
    $("#plcas").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}
/* ---------------- Éditeur de murs : vue de face, glisser pour placer, toucher pour régler ---------------- */
const TAILLES = Array.from({ length: 23 }, (_, i) => +(0.25 + i * 0.05).toFixed(2));
function vMurs(z, cave) {
  const plan = JSON.parse(JSON.stringify(cave.plan || PLAN_DEF)), H = plan.hauteur || 2.4, M = plan.module || 0.5;
  const rgs = S.d.rangements.filter((r) => r.cave_id === cave.id).map((r) => ({ ...r, mur: r.mur || "N" }));
  const P0 = positions(plan, rgs);
  const E = Object.fromEntries(rgs.map((r) => [r.id, { mur: r.mur, x: P0[r.id].x, y: P0[r.id].y, w: +r.largeur_m || M, h: +r.hauteur_m || M, forme: r.forme || "grille" }]));
  const nom = (id) => rgs.find((r) => r.id === id).nom.replace(/^Casier\s*/i, "");
  let mur = S.ui.murEd && rgs.some((r) => r.mur === S.ui.murEd) ? S.ui.murEd : (["O", "N", "E", "S"].find((k) => rgs.some((r) => r.mur === k)) ?? "N");
  let sel = null, modifie = false;
  const sc = 220, pad = 24;
  z.innerHTML = `<section class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><div class="seg" id="mursel"></div><button class="btn primary" id="mursave" disabled>Enregistrer</button></div>
    <div class="mur2d-wrap"><svg id="mursvg" class="mur2d" role="img" aria-label="Mur vu de face"></svg></div>
    <div class="note">Le mur est vu de face, comme quand tu es devant. Fais glisser un casier pour le placer (il s'aligne tout seul sur ses voisins). Touche-le pour changer son numéro, sa forme ou sa taille.</div>
    <div id="murfiche"></div></section>`;
  const svg = $("#mursvg");
  const motif = (f, w, h) => {
    const l = (a, b, c, d) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`;
    if (f === "croix") return l(0, 0, w, h) + l(w, 0, 0, h);
    if (f === "diagonale") return l(0, h, w, 0);
    if (f === "losange") return l(0, 0, w, h) + l(w, 0, 0, h) + l(0, h / 2, w / 2, 0) + l(w / 2, h, w, h / 2) + l(0, h / 2, w / 2, h) + l(w / 2, 0, w, h / 2);
    if (f === "grille") return Array.from({ length: 5 }, (_, i) => l((w * (i + 1)) / 6, 0, (w * (i + 1)) / 6, h)).join("");
    if (f === "cases") return Array.from({ length: 4 }, (_, i) => l((w * (i + 1)) / 5, 0, (w * (i + 1)) / 5, h)).join("") + l(0, h / 2, w, h / 2);
    return "";
  };
  function dessiner() {
    const long = longueurMur(plan, mur), vw = long * sc + pad * 2, vh = H * sc + pad * 2;
    svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
    const X = (x) => pad + x * sc, Y = (y) => pad + (H - y) * sc;
    let h = `<rect x="${X(0)}" y="${Y(H)}" width="${long * sc}" height="${H * sc}" class="m2-mur"/><line x1="${X(0)}" y1="${Y(0)}" x2="${X(long)}" y2="${Y(0)}" class="m2-sol"/>`;
    for (let x = 0; x <= long + 0.001; x += 0.5) h += `<text x="${X(x)}" y="${Y(0) + 16}" class="m2-reg" text-anchor="middle">${x.toFixed(1).replace(".", ",")}</text>`;
    const p = plan.porte;
    if (p && (p.mur || "S") === mur) { const le = mur === "S" ? plan.largeur - p.debut - p.largeur : p.debut; h += `<rect x="${X(le)}" y="${Y(2.02)}" width="${p.largeur * sc}" height="${2.02 * sc}" class="m2-porte"/><text x="${X(le + p.largeur / 2)}" y="${Y(1.1)}" text-anchor="middle" class="m2-reg">Porte</text>`; }
    for (const r of rgs) {
      const e = E[r.id]; if (e.mur !== mur) continue;
      const w = e.w * sc, hh = e.h * sc;
      h += `<g class="m2-cas${sel === r.id ? " on" : ""}" data-id="${r.id}" transform="translate(${X(e.x)} ${Y(e.y + e.h)})"><rect width="${w}" height="${hh}" rx="3"/><g class="m2-motif">${motif(e.forme, w, hh)}</g>
        <rect class="m2-tag" x="6" y="${hh - 26}" width="${Math.max(34, nom(r.id).length * 11 + 10)}" height="20" rx="3"/><text x="11" y="${hh - 11}" class="m2-t">${esc(nom(r.id))}</text></g>`;
    }
    svg.innerHTML = h;
    $("#mursel").innerHTML = ["O", "N", "E", "S"].map((k) => `<button data-mur="${k}" aria-pressed="${k === mur}">${MUR_COURT[k]}${lettreMur(rgs.filter((r) => E[r.id].mur === k), k)}</button>`).join("");
    $("#mursave").disabled = !modifie;
  }
  function fiche() {
    if (!sel) { $("#murfiche").innerHTML = ""; return; }
    const e = E[sel], opts = (arr, v, f = (x) => x) => arr.map((x) => `<option value="${x}" ${String(x) === String(v) ? "selected" : ""}>${f(x)}</option>`).join("");
    const nb = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === sel).length;
    $("#murfiche").innerHTML = `<div class="card" style="margin-top:12px;box-shadow:none;border:1px solid var(--line)"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Casier ${esc(nom(sel))}</h2><span class="muted" style="font-size:13px">${nb} bouteille${nb > 1 ? "s" : ""}</span></div>
      <div class="form" style="margin-top:8px">
      <label class="f">Numéro de ce casier<select id="mfn">${rgs.map((r) => `<option value="${r.id}" ${r.id === sel ? "selected" : ""}>${esc(nom(r.id))}${E[r.id].mur !== mur ? " (" + MUR_COURT[E[r.id].mur].toLowerCase() + ")" : ""}</option>`).join("")}</select></label>
      <label class="f">Forme<select id="mff">${opts(Object.keys(FORMES), e.forme, (k) => FORMES[k])}</select></label>
      <label class="f">Largeur<select id="mfw">${opts(TAILLES, e.w.toFixed(2), (x) => Math.round(x * 100) + " cm")}</select></label>
      <label class="f">Hauteur<select id="mfh">${opts(TAILLES, e.h.toFixed(2), (x) => Math.round(x * 100) + " cm")}</select></label>
      <label class="f">Mur<select id="mfm">${opts(["O", "N", "E", "S"], e.mur, (k) => MUR_COURT[k])}</select></label></div>
      <div class="note">Changer le numéro échange ce casier avec celui qui porte ce numéro : les bouteilles suivent leur numéro.</div></div>`;
    const maj = () => { modifie = true; dessiner(); fiche(); };
    $("#mfn").onchange = (ev) => { const autre = ev.target.value; if (autre === sel) return; [E[sel], E[autre]] = [E[autre], E[sel]]; sel = autre; mur = E[sel].mur; maj(); };
    $("#mff").onchange = (ev) => { e.forme = ev.target.value; maj(); };
    $("#mfw").onchange = (ev) => { e.w = +ev.target.value; maj(); };
    $("#mfh").onchange = (ev) => { e.h = +ev.target.value; maj(); };
    $("#mfm").onchange = (ev) => { e.mur = ev.target.value; e.x = 0.05; e.y = 0; mur = e.mur; maj(); };
  }
  // Glisser-déposer avec aimantation sur les bords des voisins et le pas de 5 cm
  let drag = null;
  const pt = (ev) => { const m = svg.getScreenCTM().inverse(); const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m); return [p.x / sc, -p.y / sc]; };
  svg.addEventListener("pointerdown", (ev) => {
    const g = ev.target.closest(".m2-cas"); if (!g) return;
    ev.preventDefault(); g.setPointerCapture(ev.pointerId);
    const id = g.dataset.id, [px, py] = pt(ev);
    drag = { id, g, px, py, x0: E[id].x, y0: E[id].y, cx: ev.clientX, cy: ev.clientY, bouge: false };
  });
  svg.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    if (!drag.bouge && Math.hypot(ev.clientX - drag.cx, ev.clientY - drag.cy) < 5) return;
    drag.bouge = true;
    const [px, py] = pt(ev), e = E[drag.id], long = longueurMur(plan, mur);
    let x = drag.x0 + (px - drag.px), y = drag.y0 + (py - drag.py);
    const voisins = rgs.filter((r) => r.id !== drag.id && E[r.id].mur === mur).map((r) => E[r.id]);
    const cx = [0, long - e.w, ...voisins.flatMap((v) => [v.x, v.x + v.w, v.x - e.w, v.x + v.w - e.w])];
    const cy = [0, ...voisins.flatMap((v) => [v.y, v.y + v.h, v.y - e.h, v.y + v.h - e.h])];
    const aim = (val, c) => { const b = c.reduce((m, k) => (Math.abs(k - val) < Math.abs(m - val) ? k : m), Infinity); return Math.abs(b - val) < 0.04 ? b : Math.round(val / 0.05) * 0.05; };
    e.x = Math.min(long - e.w, Math.max(0, aim(x, cx))); e.y = Math.min(H - e.h, Math.max(0, aim(y, cy)));
    e.x = +e.x.toFixed(3); e.y = +e.y.toFixed(3);
    drag.g.setAttribute("transform", `translate(${pad + e.x * sc} ${pad + (H - e.y - e.h) * sc})`);
  });
  const fin = () => {
    if (!drag) return;
    const { id, bouge } = drag; drag = null;
    if (bouge) modifie = true;
    sel = id; dessiner(); fiche();
  };
  svg.addEventListener("pointerup", fin); svg.addEventListener("pointercancel", fin);
  $("#mursel").onclick = (ev) => { const b = ev.target.closest("[data-mur]"); if (!b) return; mur = S.ui.murEd = b.dataset.mur; sel = null; dessiner(); fiche(); };
  $("#mursave").onclick = async () => {
    $("#mursave").disabled = true;
    plan.pos = Object.fromEntries(rgs.map((r) => [r.id, { x: E[r.id].x, y: E[r.id].y }]));
    await q(sb.from(T("caves")).update({ plan }).eq("id", cave.id));
    for (const r of rgs) {
      const e = E[r.id];
      if (e.mur !== r.mur || e.forme !== (r.forme || "grille") || e.w !== (+r.largeur_m || M) || e.h !== (+r.hauteur_m || M))
        await q(sb.from(T("rangements")).update({ mur: e.mur, forme: e.forme, largeur_m: e.w, hauteur_m: e.h }).eq("id", r.id));
    }
    toast("Disposition enregistrée."); S.ui.murEd = mur; refresh();
  };
  dessiner();
}
function casier(r) {
  const bs = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id);
  if (["caisse", "vrac"].includes(r.type)) {
    return `<div class="row">${bs.map((b) => { const v = S.d.vins.find((x) => x.id === b.vin_id); return v ? `<a class="chip" href="#vin-${v.id}" style="text-decoration:none;color:inherit"><b style="background:${COL[v.couleur] || COL.autre}"></b>${esc(v.domaine)} ${v.millesime ?? ""}</a>` : ""; }).join("") || `<span class="muted">Vide</span>`}<button class="btn sm" data-slot="${r.id}|0|0">+ Ranger ici</button></div>`;
  }
  let h = `<div class="racklab"></div>` + [...Array(r.colonnes)].map((_, c) => `<div class="racklab">${esc(labC(r, c + 1))}</div>`).join("");
  for (let l = 1; l <= r.lignes; l++) {
    h += `<div class="racklab">${esc(labL(r, l))}</div>`;
    for (let c = 1; c <= r.colonnes; c++) {
      const ici = bs.filter((x) => x.ligne === l && x.colonne === c), b = ici.find((x) => x.emplacement !== ARR) || ici[0]; const v = b && S.d.vins.find((x) => x.id === b.vin_id);
      h += v ? `<a class="slot full" href="#vin-${v.id}" style="background:${COL[v.couleur] || COL.autre};text-decoration:none${r.type === "losange" ? ";border-radius:6px;transform:rotate(45deg) scale(.8)" : ""}" title="${esc(ici.map((x) => nomVin(S.d.vins.find((y) => y.id === x.vin_id) || {})).join(" + "))} · ${esc(labL(r, l))}${esc(labC(r, c))}${profRg(r) > 1 ? ` · ${ici.length}/2` : ""}">${String(v.millesime ?? "NM").slice(-2)}${ici.length > 1 ? "<sup>×2</sup>" : ""}</a>`
        : `<button class="slot" data-slot="${r.id}|${l}|${c}" title="Place libre ${esc(labL(r, l))}${esc(labC(r, c))}" ${r.type === "losange" ? 'style="border-radius:6px;transform:rotate(45deg) scale(.8)"' : ""}>+</button>`;
    }
  }
  return `<div class="rack" style="grid-template-columns:28px repeat(${r.colonnes},minmax(30px,1fr))">${h}</div>`;
}
function rangerIci(rid, l, c) {
  const libres = S.d.bouteilles.filter((b) => b.statut === "en_cave" && !b.rangement_id);
  const r = S.d.rangements.find((x) => x.id === rid);
  const parVin = {}; libres.forEach((b) => (parVin[b.vin_id] ??= []).push(b));
  const autres = S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id);
  const opt = (b) => { const v = S.d.vins.find((x) => x.id === b.vin_id); return `<option value="${b.id}">${esc(v ? nomVin(v) : "?")} — ${esc(emplacementTxt(b))}</option>`; };
  modal(`<h2>Ranger dans ${esc(r.nom)}${l ? ` · ${esc(labL(r, l))}${esc(labC(r, c))}` : ""}</h2>
    <label class="f">Bouteille<select id="rb">${Object.values(parVin).length ? `<optgroup label="Non rangées">${Object.values(parVin).map((a) => opt(a[0])).join("")}</optgroup>` : ""}${autres.length ? `<optgroup label="Déplacer depuis un autre emplacement">${autres.map(opt).join("")}</optgroup>` : ""}</select></label>
    ${!libres.length && !autres.length ? `<p class="muted">Aucune bouteille en cave. <a href="#scan">Ajoute une bouteille</a>.</p>` : ""}
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button" ${!libres.length && !autres.length ? "disabled" : ""}>Ranger</button></div>`, () => {
    $("#ok").onclick = async () => {
      const b = S.d.bouteilles.find((x) => x.id === $("#rb").value); const v = S.d.vins.find((x) => x.id === b.vin_id); const avant = emplacementTxt(b);
      const pris = new Set(S.d.bouteilles.filter((x) => x.id !== b.id && x.statut === "en_cave" && x.rangement_id === rid && l && x.ligne === l && x.colonne === c).map((x) => (x.emplacement === ARR ? 2 : 1)));
      const d = [1, 2].slice(0, profRg(S.d.rangements.find((x) => x.id === rid))).find((k) => !pris.has(k)) || 1, emp = l && d === 2 ? ARR : null;
      await q(sb.from(T("bouteilles")).update({ rangement_id: rid, ligne: l || null, colonne: c || null, emplacement: emp }).eq("id", b.id));
      b.rangement_id = rid; b.ligne = l || null; b.colonne = c || null; b.emplacement = emp;
      await journal("deplacement", v, 1, `${avant} → ${emplacementTxt(b)}`);
      closeModal(); toast("Bouteille rangée."); refresh();
    };
  });
}
function formCave(c = null) {
  modal(`<h2>${c ? "Modifier la cave" : "Nouvelle cave"}</h2><div class="form">
    <label class="f wide">Nom<input id="cn" required value="${esc(c?.nom ?? "")}" placeholder="Cave principale"></label>
    <label class="f">Lieu<input id="cl" value="${esc(c?.lieu ?? "")}" placeholder="Maison, sous-sol"></label>
    <label class="f">Température (°C)<input id="ct" type="number" step="0.5" value="${esc(c?.temperature ?? "")}"></label>
    <label class="f wide">Description<textarea id="cd">${esc(c?.description ?? "")}</textarea></label>
    <label class="f">Type de cave<select id="cty">${Object.entries(STYLES_CAVE).map(([k, l]) => `<option value="${k}" ${(c?.plan?.style || "piece") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <div class="f wide" id="arm"></div>
    <div class="f wide"><span>Fond de la 3D</span><div id="cfo">${grilleFonds(c ? c.plan?.fond || "lin" : "auto")}</div></div>
    <div class="f wide"><span>Photos de la cave <small class="muted">(jusqu'à ${MAX_PH_CAVE}, pour la modélisation 3D)</small></span>
      <div class="ph-cave" id="phc"></div>
      <label class="btn sm ph-add"><input type="file" id="phin" accept="image/*" multiple hidden>+ Ajouter des photos</label>
      <small class="muted">Prends chaque mur de face, puis les casiers de près (en croix, en losange, étagères…). Les photos restent privées.</small></div></div>
    <div class="dlg-foot">${c ? `<button class="btn danger" id="del" type="button">Supprimer</button>` : ""}<button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Enregistrer</button></div>`, () => {
    const ph = photosCave(c?.id);
    const sansRg = !c || !S.d.rangements.some((x) => x.cave_id === c.id);
    const arm = () => {
      const z = $("#arm"); if ($("#cty").value !== "armoire" || !sansRg) { z.innerHTML = $("#cty").value === "armoire" && !sansRg ? `<small class="muted">Les clayettes de cette cave se modifient dans « Ajouter un rangement ».</small>` : ""; return; }
      if (!z.dataset.ok) {
        z.dataset.ok = "1"; const p = c?.plan || {};
        z.innerHTML = `<span>Remplissage de la cave électrique</span><div class="ar-choix">${Object.entries(REMPLISSAGES).map(([k, v], i) => `<label><input type="radio" name="arr" value="${k}" ${i ? "" : "checked"}><b>${v.l}</b><small>${v.d}</small></label>`).join("")}</div>
          <div class="form" style="margin-top:10px"><label class="f">Hauteur intérieure (cm)<input id="arh" type="number" min="40" max="220" value="${Math.round((p.hauteur || 1.3) * 100)}"></label><label class="f">Largeur intérieure (cm)<input id="arw" type="number" min="30" max="120" value="${Math.round((p.largeur || 0.6) * 100)}"></label>
          <label class="f">Nombre de clayettes<input id="arn" type="number" min="1" max="20" value="6"></label><label class="f">Bouteilles par clayette<input id="arc" type="number" min="1" max="16" value="6"></label>
          <label class="f">Rangs empilés par étagère<input id="arg" type="number" min="1" max="6" value="1"></label><label class="f">Profondeur<select id="arp"><option value="1">1 bouteille</option><option value="2">2 bouteilles l'une derrière l'autre</option></select></label></div>
          <figure class="ar-prev" id="arv"></figure>`;
        z.addEventListener("change", (e) => { if (e.target.name === "arr") { const v = REMPLISSAGES[e.target.value]; $("#arn").value = v.nb; $("#arg").value = v.rangs; } dessinArm(); });
        z.addEventListener("input", dessinArm);
      }
      dessinArm();
    };
    const optArm = () => { const v = REMPLISSAGES[$("#arm [name=arr]:checked")?.value || "clayettes"]; return { w: Math.min(1.2, Math.max(0.3, (+$("#arw").value || 60) / 100)), h: Math.min(2.2, Math.max(0.4, (+$("#arh").value || 130) / 100)), nb: Math.max(1, Math.min(20, +$("#arn").value || 1)), cols: Math.max(1, Math.min(16, +$("#arc").value || 1)), rangs: Math.max(1, Math.min(6, +$("#arg").value || 1)), prof: +$("#arp").value || 1, bas: v.bas, pres: v.pres }; };
    const dessinArm = () => { const o = optArm(), d = svgArmoire(o), n = clayettesArmoire(o).length; $("#arv").innerHTML = `<svg viewBox="0 0 ${d.VW.toFixed(1)} ${d.VH.toFixed(1)}" role="img" aria-label="Aperçu de la cave électrique">${d.svg}</svg><figcaption><b>${capArmoire(o)} bouteilles</b> · ${n} niveau${n > 1 ? "x" : ""} · ${Math.round(o.w * 100)} × ${Math.round(o.h * 100)} cm</figcaption>`; };
    $("#cty").addEventListener("change", arm); arm();
    $("#cfo").onclick = (e) => { const b = e.target.closest("[data-fond]"); if (b) $("#cfo").querySelectorAll("[data-fond]").forEach((x) => x.setAttribute("aria-pressed", x === b)); };
    $("#ok").onclick = async () => {
      const row = { nom: $("#cn").value.trim(), lieu: $("#cl").value.trim() || null, temperature: $("#ct").value ? +$("#ct").value : null, description: $("#cd").value.trim() || null };
      const sty = $("#cty").value, fond = $("#cfo [aria-pressed=true]")?.dataset.fond || "lin";
      let plan = c?.plan ? { ...c.plan } : null;
      if (!plan || (sty === "armoire") !== (plan.style === "armoire")) plan = { ...PLAN_TYPE[sty] };
      const genArm = sty === "armoire" && sansRg && $("#arv") ? optArm() : null;
      if (genArm) Object.assign(plan, { largeur: genArm.w + 0.04, hauteur: genArm.h, longueur: plan.longueur || 0.6, murs: { N: "Fond de l'armoire", E: "Paroi droite", O: "Paroi gauche", S: "Porte vitrée" } });
      row.plan = { ...plan, style: sty, fond };
      if (!row.nom) return toast("Donne un nom à la cave.");
      $("#ok").disabled = true;
      let id = c?.id;
      if (c) await q(sb.from(T("caves")).update(row).eq("id", c.id));
      else { const [n] = await q(sb.from(T("caves")).insert(row).select()); S.ui.cave = id = n.id; }
      if (genArm) {
        const cl = clayettesArmoire(genArm);
        const ids = await q(sb.from(T("rangements")).insert(cl.map((x, i) => ({ cave_id: id, nom: x.nom, type: "grille", forme: "clayette", mur: "N", lignes: x.lignes, colonnes: x.colonnes, libelle_lignes: "R", libelle_colonnes: "C", plan_col: 0, plan_niv: i, largeur_m: +x.w.toFixed(3), hauteur_m: +x.h.toFixed(3), ordre: cl.length - 1 - i }))).select("id"));
        const pos = {}, prof = {}; (ids || []).forEach((x, i) => { pos[x.id] = { x: 0.02, y: +cl[i].y.toFixed(3) }; if (profClay(genArm, cl[i]) > 1) prof[x.id] = 2; });
        await q(sb.from(T("caves")).update({ plan: { ...row.plan, pos, prof } }).eq("id", id));
      }
      const nb = await ph.envoyer(id);
      const f = S.apresCave; S.apresCave = null; closeModal(); toast(nb ? `Cave enregistrée avec ${nb} photo${nb > 1 ? "s" : ""}.` : "Cave enregistrée."); refresh().then(() => f && f(id));
    };
    if (c) $("#del").onclick = async () => {
      if ($("#del").dataset.sure !== "1") { $("#del").dataset.sure = "1"; $("#del").textContent = "Confirmer la suppression"; return; }
      await q(sb.from(T("caves")).delete().eq("id", c.id)); closeModal(); toast("Cave supprimée. Ses bouteilles sont devenues non rangées."); refresh();
    };
  });
}
/* Photos de la cave : stockage privé <uid>/caves/<caveId>/ (jusqu'à 15) */
const MAX_PH_CAVE = 15;
const dossierCave = (id) => `${S.user.id}/caves/${id}`;
async function listePhotosCave(id) {
  if (!id) return [];
  const { data } = await sb.storage.from("etiquettes").list(dossierCave(id), { limit: 50, sortBy: { column: "name", order: "asc" } });
  const noms = (data || []).filter((f) => f.name.endsWith(".jpg")).map((f) => `${dossierCave(id)}/${f.name}`);
  if (!noms.length) return [];
  const { data: u } = await sb.storage.from("etiquettes").createSignedUrls(noms, 3600);
  return (u || []).map((x, i) => ({ chemin: noms[i], url: x.signedUrl }));
}
function photosCave(caveId) {
  let existantes = [], nouvelles = [];
  const z = () => $("#phc");
  const dessiner = () => {
    if (!z()) return;
    z().innerHTML = existantes.map((p, i) => `<figure><img src="${esc(p.url)}" alt=""><button type="button" data-supe="${i}" aria-label="Supprimer">×</button></figure>`).join("") + nouvelles.map((p, i) => `<figure class="nouv"><img src="${p.url}" alt=""><button type="button" data-supn="${i}" aria-label="Retirer">×</button></figure>`).join("") || `<div class="muted" style="font-size:13px">Aucune photo.</div>`;
    const plein = existantes.length + nouvelles.length >= MAX_PH_CAVE; $("#phin").disabled = plein; $(".ph-add").classList.toggle("off", plein);
  };
  listePhotosCave(caveId).then((l) => { existantes = l; dessiner(); });
  dessiner();
  $("#phin").onchange = async (e) => {
    const place = MAX_PH_CAVE - existantes.length - nouvelles.length;
    const fs = [...e.target.files].slice(0, place); if (e.target.files.length > place) toast(`${MAX_PH_CAVE} photos maximum.`);
    for (const f of fs) { const b = await compresser(f, 2000); nouvelles.push({ blob: b, url: URL.createObjectURL(b) }); }
    e.target.value = ""; dessiner();
  };
  $("#phc").onclick = async (e) => {
    const n = e.target.closest("[data-supn]"), x = e.target.closest("[data-supe]");
    if (n) { nouvelles.splice(+n.dataset.supn, 1); dessiner(); }
    if (x) { const p = existantes[+x.dataset.supe]; await sb.storage.from("etiquettes").remove([p.chemin]); existantes.splice(+x.dataset.supe, 1); dessiner(); }
  };
  return {
    envoyer: async (id) => {
      let ok = 0;
      for (const [i, p] of nouvelles.entries()) {
        const { error } = await sb.storage.from("etiquettes").upload(`${dossierCave(id)}/${Date.now()}-${i}.jpg`, p.blob, { contentType: "image/jpeg" });
        if (!error) ok++;
      }
      if (ok < nouvelles.length) toast(`${nouvelles.length - ok} photo(s) non envoyée(s).`);
      return ok;
    },
  };
}
// Aperçu en direct du rangement en cours de configuration : vu de face sur son mur, et sa grille de places
/* ---------------- Rendu soigné des casiers (aperçus de formulaires) ---------------- */
let SVGU = 0;
const VERRES = [["#2b3a22", "#0c1209", "#55704a"], ["#3a1d12", "#120806", "#7a4a2e"], ["#1f2b1c", "#080c07", "#4b5f45"], ["#6c6a2a", "#2a2a0c", "#b5b264"], ["#2a1a26", "#0d070b", "#6a4a60"]];
const hashN = (i) => { let x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
function defsRendu(u) {
  return `<defs>
    <linearGradient id="${u}bo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d2a46c"/><stop offset=".45" stop-color="#b07d45"/><stop offset="1" stop-color="#7a5026"/></linearGradient>
    <linearGradient id="${u}bv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5a2c"/><stop offset=".35" stop-color="#c3925a"/><stop offset=".7" stop-color="#a87740"/><stop offset="1" stop-color="#714820"/></linearGradient>
    <radialGradient id="${u}tr" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#070504"/><stop offset=".75" stop-color="#1c130d"/><stop offset="1" stop-color="#3b2818"/></radialGradient>
    <radialGradient id="${u}mur" cx=".5" cy=".15" r="1"><stop offset="0" stop-color="#4a3a2e"/><stop offset="1" stop-color="#1b1511"/></radialGradient>
    <linearGradient id="${u}fd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d14"/><stop offset="1" stop-color="#140d09"/></linearGradient>
    ${VERRES.map((v, i) => `<radialGradient id="${u}v${i}" cx=".42" cy=".38" r=".7"><stop offset="0" stop-color="${v[2]}"/><stop offset=".55" stop-color="${v[0]}"/><stop offset="1" stop-color="${v[1]}"/></radialGradient>`).join("")}
    <filter id="${u}gr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .035" numOctaves="3" seed="7"/><feColorMatrix values="0 0 0 0 .22 0 0 0 0 .12 0 0 0 0 .04 0 0 0 .55 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
    <filter id="${u}om" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.2" flood-color="#000" flood-opacity=".55"/></filter>
    <linearGradient id="${u}rf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".6" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <linearGradient id="${u}inox" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1b1c20"/><stop offset=".5" stop-color="#3a3d44"/><stop offset="1" stop-color="#16171a"/></linearGradient>
    <linearGradient id="${u}led" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe0ff" stop-opacity=".55"/><stop offset="1" stop-color="#cfe0ff" stop-opacity="0"/></linearGradient>
  </defs>`;
}
/** Bois : planche avec dégradé et veinage. */
const planche = (u, x, y, w, h, vertical = false, rx = 0.6) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="url(#${u}${vertical ? "bv" : "bo"})"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="#000" filter="url(#${u}gr)" opacity=".8"/><rect x="${x}" y="${y}" width="${w}" height="${Math.min(0.5, h / 4)}" fill="#fff" opacity=".18"/>`;
/** Cul de bouteille vu de face (r en unités du dessin), ou alvéole vide. */
function culBouteille(u, x, y, r, i, plein = true, arriere = false) {
  const f = (n) => +n.toFixed(2);
  if (!plein) return `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${u}tr)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="none" stroke="#5a3e26" stroke-width="${f(r * 0.08)}" opacity=".7"/>`;
  const v = Math.floor(hashN(i) * VERRES.length);
  return `<g${arriere ? ' opacity=".55"' : ""}><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${u}v${v})" filter="url(#${u}om)"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.86)}" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="${f(r * 0.1)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.42)}" fill="#000" opacity=".38"/><circle cx="${f(x + r * 0.06)}" cy="${f(y + r * 0.06)}" r="${f(r * 0.3)}" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="${f(r * 0.06)}"/><ellipse cx="${f(x - r * 0.38)}" cy="${f(y - r * 0.42)}" rx="${f(r * 0.26)}" ry="${f(r * 0.13)}" transform="rotate(-35 ${f(x - r * 0.38)} ${f(y - r * 0.42)})" fill="#fff" opacity=".38"/></g>`;
}
/** Face d'un casier, en centimètres, centrée sur (0,0). Renvoie le SVG complet. */
function svgCasier(r, prof = 1) {
  const u = `k${++SVGU}`, w = Math.max(10, r.largeur_m * 100), h = Math.max(10, r.hauteur_m * 100), m = 7, vrac = ["caisse", "vrac"].includes(r.type);
  const VW = w + 2 * m, VH = h + 2 * m + 3, ox = m + w / 2, oy = m + h / 2;
  let s = defsRendu(u) + `<rect x="0" y="0" width="${VW}" height="${VH}" rx="4" fill="url(#${u}mur)"/><ellipse cx="${ox}" cy="${m + h + 2}" rx="${w / 2 + 3}" ry="2.2" fill="#000" opacity=".45"/>`;
  if (r.type === "caisse") {
    const n = Math.max(3, Math.round(h / 9)), ph = h / n;
    s += `<rect x="${m}" y="${m}" width="${w}" height="${h}" fill="#2a1a10"/>`;
    for (let i = 0; i < n; i++) s += planche(u, m + 0.4, m + i * ph + 0.4, w - 0.8, ph - 0.8, false, 0.4);
    [m + 1.5, m + w - 4.5].forEach((x) => (s += planche(u, x, m, 3, h, true, 0.3)));
    s += `<text x="${ox}" y="${oy + 1.6}" text-anchor="middle" font-family="Playfair Display,Georgia,serif" font-style="italic" font-size="${Math.min(7, w / 8)}" fill="#3a2412" opacity=".75">Grand vin</text>`;
    return { svg: s, VW, VH };
  }
  // fond et cadre
  s += `<rect x="${m}" y="${m}" width="${w}" height="${h}" fill="url(#${u}fd)"/>`;
  const E = 1.8;
  if (vrac) {
    const R = 3.7, cols = Math.max(1, Math.floor((w - 2 * E) / (2 * R))); let i = 0;
    for (let l = 0, y = m + h - E - R; y > m + E + R && l < 30; l++, y -= R * 1.74) for (let c = 0; c < cols - (l % 2); c++) s += culBouteille(u, m + E + R + (l % 2) * R + c * 2 * R, y, R * 0.96, i++, hashN(i + 3) < 0.85);
  } else {
    const g = geometrie(r.forme || "grille", r.largeur_m, r.hauteur_m, r.lignes, r.colonnes);
    const X = (x) => ox + x * 100, Y = (y) => oy - y * 100;
    let R = 3.9;
    if ((r.forme || "grille") === "grille") R = Math.min((g.iw * 100) / r.colonnes, (g.ih * 100) / r.lignes) * 0.42;
    const pleins = g.slots.map((_, i) => hashN(i + 11) < 0.72);
    if (prof > 1) g.slots.forEach((sl, i) => (s += culBouteille(u, X(sl.x) + R * 0.28, Y(sl.y) - R * 0.32, R, i + 500, hashN(i + 41) < 0.6, true)));
    g.slots.forEach((sl, i) => (s += culBouteille(u, X(sl.x), Y(sl.y), R, i, pleins[i])));
    for (const t of g.traits) {
      const L = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) * 100, e = Math.max(0.9, t.e * 100), ang = (Math.atan2(-(t.y2 - t.y1), t.x2 - t.x1) * 180) / Math.PI;
      s += `<g transform="translate(${X(t.x1).toFixed(2)} ${Y(t.y1).toFixed(2)}) rotate(${ang.toFixed(2)})" filter="url(#${u}om)">${planche(u, 0, -e / 2, L, e, false, 0.3)}</g>`;
    }
  }
  s += planche(u, m - E, m - E, w + 2 * E, E * 1.4) + planche(u, m - E, m + h - E * 0.4, w + 2 * E, E * 1.4) + planche(u, m - E, m - E, E * 1.4, h + 2 * E, true) + planche(u, m + w - E * 0.4, m - E, E * 1.4, h + 2 * E, true);
  return { svg: s, VW, VH };
}
/** Cave électrique vue de face : caisson, porte vitrée, éclairage LED et clayettes. */
const REMPLISSAGES = {
  clayettes: { l: "Clayettes coulissantes", d: "Une rangée de bouteilles couchées par clayette, idéal pour voir chaque étiquette.", nb: 6, rangs: 1, bas: 0 },
  mixte: { l: "Clayettes + stockage en bas", d: "Clayettes en haut, bouteilles empilées en bas pour le stockage longue garde.", nb: 4, rangs: 1, bas: 1 },
  empile: { l: "Stockage maximal (empilé)", d: "Étagères pleines où les bouteilles sont empilées en quinconce.", nb: 3, rangs: 3, bas: 0 },
  presentation: { l: "Présentation + clayettes", d: "Une clayette de présentation inclinée en haut, puis des clayettes classiques.", nb: 5, rangs: 1, bas: 0, pres: 1 },
};
/** Calcule les clayettes (en m, depuis le bas de l'intérieur) d'une cave électrique. */
function clayettesArmoire(o) {
  const H = o.h - 0.1, W = o.w - 0.04, liste = [];
  const hBas = o.bas ? Math.min(0.42, H * 0.3) : 0, hPres = o.pres ? 0.16 : 0;
  const reste = H - hBas - hPres, hc = Math.max(0.08, reste / Math.max(1, o.nb));
  let y = 0.03;
  const pile = Math.max(1, Math.floor((W * 100 - 4) / 7.4));
  if (o.bas) { liste.push({ nom: "Stockage bas", y, h: hBas - 0.02, lignes: Math.max(2, Math.floor((hBas - 0.04) / 0.066)), colonnes: pile, bas: true }); y += hBas; }
  for (let i = 0; i < o.nb; i++) { const rg = Math.max(1, Math.min(o.rangs, Math.floor((hc - 0.03) / 0.066))); liste.push({ nom: "", y, h: hc - 0.02, lignes: rg, colonnes: rg > 1 ? pile : o.cols }); y += hc; }
  if (o.pres) liste.push({ nom: "Présentation", y, h: hPres - 0.02, lignes: 1, colonnes: Math.max(2, o.cols - 1), pres: true });
  let n = 0; for (let i = liste.length - 1; i >= 0; i--) if (!liste[i].nom) liste[i].nom = `Clayette ${++n}`;
  return liste.map((c) => ({ ...c, w: W }));
}
function svgArmoire(o) {
  const u = `a${++SVGU}`, W = o.w * 100, H = o.h * 100, ep = 4, m = 8, VW = W + 2 * ep + 2 * m, VH = H + 2 * ep + m * 2 + 6;
  const x0 = m + ep, y0 = m + ep, f = (n) => +n.toFixed(2);
  let s = defsRendu(u) + `<rect width="${VW}" height="${VH}" rx="5" fill="url(#${u}mur)"/><ellipse cx="${VW / 2}" cy="${y0 + H + ep + 5}" rx="${W / 2 + 8}" ry="3" fill="#000" opacity=".5"/>`;
  s += `<rect x="${m}" y="${m}" width="${W + 2 * ep}" height="${H + 2 * ep + 3}" rx="3" fill="url(#${u}inox)"/><rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="#0d0f14"/><rect x="${x0}" y="${y0}" width="${W}" height="${Math.min(40, H * 0.4)}" fill="url(#${u}led)"/>`;
  s += `<rect x="${x0 + 4}" y="${y0 + 1}" width="${W - 8}" height="1" rx=".5" fill="#e8f0ff"/>`;
  let i = 0;
  for (const c of clayettesArmoire(o)) {
    const yb = y0 + H - c.y * 100, cw = W - 4, R = c.bas || c.lignes > 1 ? 3.55 : Math.min((cw / c.colonnes / 2) * 0.92, c.pres ? 4 : 3.8);
    if (c.bas || c.lignes > 1) {
      const cols = c.colonnes;
      for (let l = 0, y = yb - 2.2 - R; l < c.lignes; l++, y -= R * 1.74) for (let k = 0; k < cols - (l % 2); k++) s += culBouteille(u, x0 + 2 + R + (l % 2) * R + k * 2 * R + (cw - cols * 2 * R) / 2, y, R * 0.96, i++, hashN(i + 5) < 0.88);
    } else {
      const pas = cw / c.colonnes;
      for (let k = 0; k < c.colonnes; k++) {
        const cx = x0 + 2 + pas * (k + 0.5), cy = yb - 2.2 - R;
        if (o.prof > 1) s += culBouteille(u, cx + R * 0.3, cy - R * 0.34, R, i + 900, hashN(i + 77) < 0.65, true);
        if (c.pres) s += `<g transform="rotate(-18 ${f(cx)} ${f(cy)})">${culBouteille(u, cx, cy, R, i, true)}</g>`;
        else s += culBouteille(u, cx, cy, R, i, hashN(i + 9) < 0.8);
        i++;
      }
    }
    s += `<g filter="url(#${u}om)">${planche(u, x0 + 0.5, yb - 2, W - 1, 2.6, false, 0.4)}</g><rect x="${x0 + 0.5}" y="${yb - 2}" width="${W - 1}" height=".5" fill="#d9b483" opacity=".6"/>`;
  }
  s += `<rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="url(#${u}rf)"/><rect x="${x0 + 0.6}" y="${y0 + 0.6}" width="${W - 1.2}" height="${H - 1.2}" fill="none" stroke="#000" stroke-width="1.2" opacity=".6"/>`;
  s += `<rect x="${x0 + W - 3.5}" y="${y0 + H * 0.3}" width="1.6" height="${H * 0.3}" rx=".8" fill="#9aa0aa"/><rect x="${x0 + W - 3.5}" y="${y0 + H * 0.3}" width=".5" height="${H * 0.3}" fill="#fff" opacity=".5"/>`;
  s += `<rect x="${m + 3}" y="${y0 + H + ep + 2}" width="5" height="2.5" fill="#0c0c0e"/><rect x="${VW - m - 8}" y="${y0 + H + ep + 2}" width="5" height="2.5" fill="#0c0c0e"/>`;
  return { svg: s, VW, VH };
}
const profClay = (o, c) => (o.prof > 1 && !c.pres && !c.bas && c.lignes === 1 ? 2 : 1);
const capArmoire = (o) => clayettesArmoire(o).reduce((n, c) => n + c.lignes * c.colonnes * profClay(o, c), 0);
function apercuRg(caveId, r0) {
  const z = $("#rprev"); if (!z) return;
  const cave = S.d.caves.find((c) => c.id === caveId), plan = { ...PLAN_DEF, ...(cave?.plan || {}) };
  const id = r0?.id || "_nouveau";
  const r = { ...(r0 || {}), id, cave_id: caveId, nom: $("#rn").value.trim() || "Nouveau", type: $("#rt").value, forme: $("#rfo").value, mur: $("#rmu").value,
    plan_col: +$("#rpx").value || 0, plan_niv: +$("#rpy").value || 0, largeur_m: Math.max(0.1, +$("#rlw").value || 0.5), hauteur_m: Math.max(0.1, +$("#rlh").value || 0.5),
    lignes: Math.max(1, Math.min(60, +$("#rl").value || 1)), colonnes: Math.max(1, Math.min(60, +$("#rc").value || 1)) };
  const prof = +$("#rpr").value || 1, vrac = ["caisse", "vrac"].includes(r.type);
  const autres = S.d.rangements.filter((x) => x.cave_id === caveId && x.id !== id && (x.mur || "N") === r.mur);
  const POS = positions(plan, [...autres, r]);
  const L = longueurMur(plan, r.mur), H = plan.hauteur || 2.4, cm = (v) => +(v * 100).toFixed(1), pad = 8;
  const VW = cm(L) + 2 * pad, VH = cm(H) + 2 * pad;
  const X0 = (x) => pad + cm(x), Y0 = (y) => pad + cm(H - y);
  let svg = `<rect x="${pad}" y="${pad}" width="${cm(L)}" height="${cm(H)}" class="rp-mur"/><rect x="0" y="${VH - pad}" width="${VW}" height="${pad}" class="cm-sol"/>`;
  for (const a of autres) { const p = POS[a.id], w = +a.largeur_m || 0.5, h = +a.hauteur_m || 0.5;
    svg += `<rect x="${X0(p.x)}" y="${Y0(p.y + h)}" width="${cm(w)}" height="${cm(h)}" class="rp-autre"/><text x="${X0(p.x + w / 2)}" y="${Y0(p.y + h / 2) + 2}" class="rp-txt">${esc(a.nom.replace(/^Casier\s*/i, ""))}</text>`; }
  const p = POS[id], w = r.largeur_m, h = r.hauteur_m, g = geometrie(r.forme || "grille", w, h, r.lignes, r.colonnes), ox = X0(p.x + w / 2), oy = Y0(p.y + h / 2);
  const X = (x) => +(ox + x * 100).toFixed(1), Y = (y) => +(oy - y * 100).toFixed(1);
  svg += `<g class="rp-cur"><rect x="${X(-w / 2)}" y="${Y(h / 2)}" width="${cm(w)}" height="${cm(h)}" class="cm-cadre"/><rect x="${X(-g.iw / 2)}" y="${Y(g.ih / 2)}" width="${cm(g.iw)}" height="${cm(g.ih)}" class="cm-fond"/>`
    + (vrac ? [] : g.traits).map((t) => `<line x1="${X(t.x1)}" y1="${Y(t.y1)}" x2="${X(t.x2)}" y2="${Y(t.y2)}" class="cm-latte" style="stroke-width:${cm(t.e)}"/>`).join("")
    + (vrac ? `<text x="${X(0)}" y="${Y(0) + 2}" class="rp-txt" style="fill:#f3e6d4">${r.type === "caisse" ? "Caisse" : "Vrac"}</text>` : g.slots.map((sl) => { const rr = Math.max(1.2, Math.min(3.2, (cm(g.iw) / (r.forme === "grille" ? r.colonnes : 12)) * 0.38)); return (prof > 1 ? `<circle cx="${X(sl.x) + rr * 0.45}" cy="${Y(sl.y) - rr * 0.45}" r="${rr}" class="rp-place rp-arr"/>` : "") + `<circle cx="${X(sl.x)}" cy="${Y(sl.y)}" r="${rr}" class="rp-place"/>`; }).join(""))
    + `<rect x="${X(-w / 2) - 1.5}" y="${Y(h / 2) - 1.5}" width="${cm(w) + 3}" height="${cm(h) + 3}" class="rp-sel"/></g>`;
  const deborde = p.x < -0.001 || p.x + w > L + 0.001 || p.y + h > H + 0.001;
  const chev = autres.some((a) => { const q = POS[a.id], aw = +a.largeur_m || 0.5, ah = +a.hauteur_m || 0.5; return p.x < q.x + aw - 0.01 && q.x < p.x + w - 0.01 && p.y < q.y + ah - 0.01 && q.y < p.y + h - 0.01; });
  const cap = vrac ? null : r.lignes * r.colonnes * prof;
  const rendu = svgCasier(r, prof), lab = (f, n) => f(n);
  const numeros = vrac ? "Sans place numérotée" : `${esc(labL({ ...r, libelle_lignes: $("#rpl").value || "R" }, 1))} à ${esc(labL({ ...r, libelle_lignes: $("#rpl").value || "R" }, r.lignes))} · ${esc(labC({ ...r, libelle_colonnes: $("#rpc").value }, 1))} à ${esc(labC({ ...r, libelle_colonnes: $("#rpc").value }, r.colonnes))}`;
  const grille = `<figure class="rp-rendu"><svg viewBox="0 0 ${rendu.VW.toFixed(1)} ${rendu.VH.toFixed(1)}" role="img" aria-label="Rendu du rangement">${rendu.svg}</svg><figcaption>${numeros}</figcaption></figure>`;
  z.innerHTML = `<div class="rp-tete"><b>${esc(r.nom)}</b><span class="muted">${esc(MURS[r.mur] || r.mur)} · ${Math.round(w * 100)} × ${Math.round(h * 100)} cm${cap ? ` · <b>${cap} places</b>${prof > 1 ? " (2 en profondeur)" : ""}` : ""}</span></div>
    <div class="rp-vues">${grille}<figure class="rp-mini"><svg viewBox="0 0 ${VW} ${VH}" class="rp-svg" role="img" aria-label="Position sur le mur">${svg}</svg><figcaption>Sur le mur</figcaption></figure></div>
    ${deborde ? `<div class="rp-alerte">Le rangement dépasse du mur : réduisez sa taille ou sa position.</div>` : chev ? `<div class="rp-alerte">Il chevauche un autre rangement de ce mur.</div>` : ""}
    ${r0 && plan.pos?.[r0.id] ? `<div class="muted" style="font-size:12px">Ce rangement a été placé à la main sur le plan : sa colonne et son niveau sont fixés par le plan.</div>` : ""}`;
}
function formRangement(caveId, r = null) {
  modal(`<h2>${r ? "Modifier le rangement" : "Nouveau rangement"}</h2><div id="rprev" class="rg-prev"></div><div class="form">
    <label class="f wide">Nom<input id="rn" value="${esc(r?.nom ?? "")}" placeholder="Casier 1"></label>
    <label class="f wide">Type<select id="rt">${Object.entries(TYPES_RG).map(([k, l]) => `<option value="${k}" ${r?.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f">Rangées / étagères<input id="rl" type="number" min="1" max="60" value="${r?.lignes ?? 4}"></label>
    <label class="f">Colonnes / emplacements<input id="rc" type="number" min="1" max="60" value="${r?.colonnes ?? 6}"></label>
    <label class="f">Préfixe des rangées<input id="rpl" value="${esc(r?.libelle_lignes ?? "R")}" maxlength="6"></label>
    <label class="f">Préfixe des colonnes<input id="rpc" value="${esc(r?.libelle_colonnes ?? "C")}" maxlength="6"></label>
    <label class="f">Forme (3D)<select id="rfo">${Object.entries(FORMES).map(([k, l]) => `<option value="${k}" ${(r?.forme ?? "grille") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f">Mur<select id="rmu">${Object.entries(MURS).map(([k, l]) => `<option value="${k}" ${(r?.mur ?? "N") === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="f">Colonne sur le mur (0 = gauche)<input id="rpx" type="number" step="0.1" min="0" value="${r?.plan_col ?? 0}"></label>
    <label class="f">Niveau (0 = sol)<input id="rpy" type="number" step="0.5" min="0" value="${r?.plan_niv ?? 0}"></label>
    <label class="f">Largeur (m)<input id="rlw" type="number" step="0.05" min="0.1" value="${r?.largeur_m ?? 0.5}"></label>
    <label class="f">Hauteur (m)<input id="rlh" type="number" step="0.05" min="0.1" value="${r?.hauteur_m ?? 0.5}"></label>
    <label class="f">Profondeur<select id="rpr"><option value="1">1 bouteille par place</option><option value="2" ${profRg(r) === 2 ? "selected" : ""}>2 bouteilles l'une derrière l'autre</option></select></label></div>
    <div class="note">Exemples de numérotation : R1 C4, Étagère 2 Empl. 3, A1… Pour une caisse ou du vrac, les dimensions sont ignorées.</div>
    <div class="dlg-foot">${r ? `<button class="btn danger" id="del" type="button">Supprimer</button>` : ""}<button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Enregistrer</button></div>`, () => {
    const maj = () => apercuRg(caveId, r); $("#modal form").addEventListener("input", maj); $("#modal form").addEventListener("change", maj); maj();
    $("#ok").onclick = async () => {
      const row = { cave_id: caveId, nom: $("#rn").value.trim() || "Rangement", type: $("#rt").value, lignes: Math.max(1, Math.min(60, +$("#rl").value || 1)), colonnes: Math.max(1, Math.min(60, +$("#rc").value || 1)), libelle_lignes: $("#rpl").value || "R", libelle_colonnes: $("#rpc").value ?? "" };
      if ("forme" in (S.d.rangements[0] ?? { forme: 1 })) Object.assign(row, { forme: $("#rfo").value, mur: $("#rmu").value, plan_col: +$("#rpx").value || 0, plan_niv: +$("#rpy").value || 0, largeur_m: +$("#rlw").value || 0.5, hauteur_m: +$("#rlh").value || 0.5 });
      let id = r?.id;
      if (r) await q(sb.from(T("rangements")).update(row).eq("id", r.id));
      else id = (await q(sb.from(T("rangements")).insert({ ...row, ordre: S.d.rangements.filter((x) => x.cave_id === caveId).length }).select("id")))?.[0]?.id;
      const pr = +$("#rpr").value, cave = S.d.caves.find((c) => c.id === caveId);
      if (id && cave && pr !== profRg({ id, cave_id: caveId })) {
        const prof = { ...(cave.plan?.prof || {}) }; if (pr > 1) prof[id] = pr; else delete prof[id];
        await q(sb.from(T("caves")).update({ plan: { ...(cave.plan || PLAN_DEF), prof } }).eq("id", caveId));
      }
      closeModal(); toast("Rangement enregistré."); refresh();
    };
    if (r) $("#del").onclick = async () => {
      if ($("#del").dataset.sure !== "1") { $("#del").dataset.sure = "1"; $("#del").textContent = "Confirmer la suppression"; return; }
      await q(sb.from(T("rangements")).delete().eq("id", r.id)); closeModal(); toast("Rangement supprimé."); refresh();
    };
  });
}
function vListe(z) {
  const f = S.ui.filtre.toLowerCase(), c = S.ui.couleur;
  let vins = S.d.vins.filter((v) => (!c || v.couleur === c) && (!f || [v.domaine, v.cuvee, v.appellation, v.region, v.pays, v.millesime].join(" ").toLowerCase().includes(f)));
  const tri = S.ui.tri || "domaine";
  const ORD = ["rouge", "blanc", "rose", "effervescent", "liquoreux", "autre"];
  vins.sort((a, b) => tri === "couleur" ? ORD.indexOf(a.couleur || "autre") - ORD.indexOf(b.couleur || "autre") || String(a.domaine).localeCompare(b.domaine) : tri === "valeur" ? (valU(b) ?? 0) - (valU(a) ?? 0) : tri === "millesime" ? (a.millesime ?? 0) - (b.millesime ?? 0) : String(a.domaine).localeCompare(b.domaine));
  const avecSorties = S.ui.sorties;
  if (!avecSorties) vins = vins.filter((v) => qte(v.id) > 0);
  z.innerHTML = `<section class="card"><div class="row"><label class="search" style="max-width:none;flex:2"><input id="lf" placeholder="Filtrer…" value="${esc(S.ui.filtre)}"></label>
    <select id="lc" style="width:auto"><option value="">Toutes couleurs</option>${Object.entries(COUL_LIB).map(([k, l]) => `<option value="${k}" ${c === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <select id="lt" style="width:auto">${[["domaine", "Tri : domaine"], ["couleur", "Tri : couleur"], ["millesime", "Tri : millésime"], ["valeur", "Tri : valeur"]].map(([k, l]) => `<option value="${k}" ${tri === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="ls" style="width:auto" ${avecSorties ? "checked" : ""}>Vins bus</label></div>
    <div class="list">${vins.map((v) => `<a class="li" href="#vin-${v.id}" style="grid-template-columns:40px 1fr auto auto;text-decoration:none;color:inherit"><img class="thumb" src="${esc(pic(v))}" alt=""><span style="min-width:0"><b>${esc(v.domaine)}</b> <span class="muted">${esc(v.cuvee ?? "")}</span><br><span class="muted" style="font-size:12px">${esc(v.appellation ?? "")} · ${v.millesime ?? "NM"}</span></span>${phase(v) ? `<span class="chip">${phase(v)}</span>` : "<span></span>"}<span class="num" style="text-align:right">${eur(valU(v))}<br><span class="muted" style="font-size:12px">×${qte(v.id)}</span></span></a>`).join("") || `<div class="muted" style="padding:20px 0">Aucun vin ne correspond.</div>`}</div></section>`;
  const lf = $("#lf"); lf.oninput = () => { S.ui.filtre = lf.value; const pos = lf.selectionStart; vListe(z); const n = $("#lf"); n.focus(); n.setSelectionRange(pos, pos); };
  $("#lc").onchange = (e) => { S.ui.couleur = e.target.value; document.querySelectorAll("[data-coul]").forEach((x) => x.setAttribute("aria-pressed", x.dataset.coul === S.ui.couleur)); vListe(z); };
  $("#lt").onchange = (e) => { S.ui.tri = e.target.value; vListe(z); };
  $("#ls").onchange = (e) => { S.ui.sorties = e.target.checked; vListe(z); };
}

/* ---------------- Fiche vin ---------------- */
function courbeAge(v) {
  const s = v.millesime || (v.maturite_debut ? v.maturite_debut - 3 : NOW - 5);
  const m = v.maturite_debut || v.apogee_debut, a0 = v.apogee_debut, a1 = v.apogee_fin || a0, dc = v.declin_debut || a1 + 4, e = dc + 4;
  const W = 560, H = 170, p = 26, X = (y) => p + ((y - s) / (e - s)) * (W - 2 * p), Y = (qq) => H - p - qq * (H - 2 * p);
  const qf = (y) => (y < m ? 0.25 + (0.35 * (y - s)) / (m - s || 1) : y < a0 ? 0.6 + (0.35 * (y - m)) / (a0 - m || 1) : y <= a1 ? 0.95 + 0.05 * Math.sin((Math.PI * (y - a0)) / (a1 - a0 || 1)) : Math.max(0.2, 0.95 - (0.75 * (y - a1)) / (e - a1 || 1)));
  let d = ""; for (let y = s; y <= e; y += 0.25) d += (d ? "L" : "M") + X(y).toFixed(1) + "," + Y(qf(y)).toFixed(1);
  const band = (a, b, c, o) => `<rect x="${X(a)}" y="${p - 6}" width="${Math.max(0, X(b) - X(a))}" height="${H - 2 * p + 6}" fill="${c}" opacity="${o}"/>`;
  const n = Math.min(Math.max(NOW, s), e);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Courbe de vieillissement">${band(s, m, "var(--young)", 0.12)}${band(m, a0, "var(--mature)", 0.14)}${band(a0, a1, "var(--peak)", 0.14)}${band(a1, e, "var(--decline)", 0.12)}
    <path d="${d}" fill="none" stroke="var(--fg)" stroke-width="2"/><line x1="${X(n)}" x2="${X(n)}" y1="${p - 8}" y2="${H - p}" stroke="var(--fg)" stroke-dasharray="3 3"/><circle cx="${X(n)}" cy="${Y(qf(n))}" r="5" fill="var(--wine)"/>
    <text x="${X(n) + 6}" y="${p + 4}" style="fill:var(--fg);font-weight:600">Aujourd'hui</text>${[...new Set([s, m, a0, a1, dc])].map((y) => `<text x="${X(y)}" y="${H - 8}" text-anchor="middle">${y}</text>`).join("")}</svg>`;
}
function courbePrix(v) {
  const p = S.d.prix.filter((x) => x.vin_id === v.id && x.devise === "EUR");
  const parJour = {}; p.forEach((x) => (parJour[x.releve_le.slice(0, 10)] ??= []).push(+x.prix));
  const pts = Object.entries(parJour).sort().map(([d, a]) => [new Date(d), median(a)]);
  if (v.prix_achat && v.date_achat) pts.unshift([new Date(v.date_achat), +v.prix_achat]);
  if (pts.length < 2) return `<div class="muted" style="font-size:12px">L'historique se construira à chaque réévaluation.</div>`;
  return courbe(pts, 130);
}
function vFiche() {
  const v = S.d.vins.find((x) => x.id === S.arg);
  if (!v) { $("#view").innerHTML = `<section class="card empty"><h2>Vin introuvable</h2><a class="btn" href="#vins">Retour à mes vins</a></section>`; return; }
  const n = qte(v.id), ph = phase(v), bs = enCave(v.id);
  const mv = S.d.mouvements.filter((m) => m.vin_id === v.id).slice().reverse();
  const photos = S.d.photos.filter((x) => x.vin_id === v.id);
  const gc = ["var(--wine)", "var(--mature)", "var(--bubbles)", "var(--young)", "var(--rose)"];
  const cep = Array.isArray(v.cepages) ? v.cepages : [];
  const critiques = (v.avis || []).filter((a) => a.type === "critique"), parts = (v.avis || []).filter((a) => a.type !== "critique");
  const sources = v.valeur_sources || [];
  const manuels = S.d.prix.filter((p) => p.vin_id === v.id && p.source !== "wineapi.io").slice(-4).reverse();
  $("#view").innerHTML = `<a class="btn" href="#vins" style="align-self:flex-start;text-decoration:none">← Mes vins</a>
  <div class="head"><div><div class="eyebrow">${esc([v.pays, v.region, v.appellation].filter(Boolean).join(" · "))}</div><h1>${esc(v.domaine)}</h1><div class="muted" style="font-size:16px">${esc(v.cuvee ?? "")}${v.cuvee ? " · " : ""}${v.millesime ?? "Non millésimé"}</div></div>
    <div class="row"><button class="btn" id="b-add">+ Bouteilles</button><button class="btn" id="b-out" ${n ? "" : "disabled"}>Sortir une bouteille</button><button class="btn primary" id="b-edit">Modifier</button></div></div>
  <div class="grid">
    <section class="card c4"><img class="photo" src="${esc(pic(v))}" alt="Photo de la bouteille" style="aspect-ratio:3/4;max-height:380px">
      <div class="row">${photos.map((p) => `<a href="${esc(S.urls[p.chemin] || "#")}" target="_blank" rel="noopener"><img src="${esc(S.urls[p.chemin] || "")}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px"></a>`).join("")}<span class="muted" style="font-size:12px">${photos.length} photo${photos.length > 1 ? "s" : ""} d'étiquette</span></div></section>
    <section class="card c8"><div style="position:relative;border-radius:12px;overflow:hidden;height:120px;background:url(img/vignoble.jpg) center/cover"><div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(0,0,0,.6),transparent)"></div><div style="position:absolute;left:14px;bottom:10px;color:#fff"><div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">Terroir</div><b style="font-family:var(--display);font-size:20px">${esc([v.appellation, v.region].filter(Boolean).join(", ") || "Non renseigné")}</b></div></div>
      <h2>Identité</h2><div class="kv">${[["Couleur", COUL_LIB[v.couleur] ?? "—"], ["Conditionnement", v.conditionnement], ["Pays", v.pays], ["Région", v.region], ["Appellation", v.appellation], ["Domaine", v.domaine], ["Cuvée", v.cuvee], ["Millésime", v.millesime ?? "NM"], ["Degré", v.degre ? v.degre + " % vol." : null], ["Gamme", v.gamme], ["Classement", v.classement], ["Apogée", v.apogee_debut ? `${v.apogee_debut} – ${v.apogee_fin ?? "?"}` : null], ["En cave", `${n} bouteille${n > 1 ? "s" : ""}`]].map((k) => `<div><span>${k[0]}</span><b>${esc(k[1] ?? "—")}</b></div>`).join("")}</div>
      ${cep.length ? `<div><div class="eyebrow" style="margin-bottom:6px">Cépages</div><div class="grapes">${cep.map((g, i) => `<span style="width:${g.pct || 100 / cep.length}%;background:${gc[i % 5]}"></span>`).join("")}</div><div class="row" style="margin-top:6px">${cep.map((g, i) => `<span class="chip"><b style="background:${gc[i % 5]}"></b>${esc(g.nom)} ${g.pct ? `<span class="num muted">${g.pct} %</span>` : ""}</span>`).join("")}</div></div>` : ""}
      ${v.description ? `<p style="margin:0;max-width:70ch">${esc(v.description)}</p>` : ""}</section>
    <section class="card c8"><div class="row" style="justify-content:space-between"><h2>Phase de vieillissement</h2><div class="phase">${["Jeunesse", "Maturité", "Apogée", "Déclin"].map((p) => `<span class="chip" aria-current="${p === ph}">${p}</span>`).join("")}</div></div>
      ${v.apogee_debut ? courbeAge(v) : `<div class="muted">Fenêtre de garde inconnue. Renseigne-la dans « Modifier ».</div>`}
      <div class="src">Source : <span class="s">${esc(v.garde_source || "Saisie manuelle")}</span><span>· ajustable à la main</span></div></section>
    <section class="card c4" id="achat"><h2>Achat et valorisation</h2><div class="row" style="gap:22px"><div><div class="muted" style="font-size:12px">Achat (unité)</div><div class="num" style="font-size:18px">${eur(v.prix_achat)}</div></div><div><div class="muted" style="font-size:12px">Valeur actuelle</div><div class="num up" style="font-size:18px">${eur(valU(v))}</div></div>${v.prix_achat && v.valeur_unitaire ? `<div><div class="muted" style="font-size:12px">Plus-value</div><div class="num ${v.valeur_unitaire >= v.prix_achat ? "up" : "down"}" style="font-size:18px">${((v.valeur_unitaire / v.prix_achat - 1) * 100).toFixed(0)} %</div></div>` : ""}</div>
      ${courbePrix(v)}
      <div class="muted" style="font-size:12px">${v.date_achat ? `Acheté le ${dfr(v.date_achat)}` : "Date d'achat non renseignée"}${v.fournisseur ? ` · ${esc(v.fournisseur)}` : ""}${v.prix_achat ? ` · Lot en cave ${eur(v.prix_achat * n)}` : ""}</div>
      <div class="stack" style="font-size:12px;gap:4px">${[...sources.map((s) => ({ src: s.source, det: s.detail, prix: s.prix, dev: s.devise, url: s.url })), ...manuels.map((p) => ({ src: p.source, det: p.detail, prix: p.prix, dev: p.devise, url: p.url, d: p.releve_le }))].slice(0, 8).map((s) => `<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><span style="min-width:0"><span class="num">${esc(s.src)}</span> <span class="muted">${esc(s.det ?? "")}${s.d ? " · " + dfr(s.d) : ""}</span>${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">lien</a>` : ""}</span><span class="num">${s.prix} ${esc(s.dev === "EUR" ? "€" : s.dev)}</span></div>`).join("") || `<span class="muted">Aucune cote pour l'instant.</span>`}</div>
      <div class="src">Valeur retenue = médiane des sources en euros${v.valeur_maj ? ` · mise à jour le ${dfr(v.valeur_maj)}` : ""}</div>
      <div class="row"><button class="btn sm" id="b-reval">Actualiser la valeur</button><button class="btn sm" id="b-cote">+ Cote manuelle</button></div></section>
    <section class="card c4"><h2>Rangement</h2>${bs.some((b) => b.rangement_id) ? `<button class="btn primary" data-voir3d="">Voir dans la cave en 3D</button>` : ""}${bs.map((b) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid var(--line);padding-bottom:6px;flex-wrap:nowrap"><span style="font-size:13px">${esc(emplacementTxt(b))}</span><span class="row" style="gap:6px;flex-wrap:nowrap">${b.rangement_id ? `<button class="btn sm" data-voir3d="${b.id}" aria-label="Voir cette bouteille en 3D">3D</button>` : ""}<button class="btn sm" data-move="${b.id}">Déplacer</button></span></div>`).join("") || `<div class="muted">Plus de bouteille en cave.</div>`}</section>
    <section class="card c4"><h2>Avis</h2>
      ${critiques.map((a) => `<div class="review"><div class="row" style="justify-content:space-between"><b>${esc(a.auteur || "Critique")}</b><span class="num">${esc(a.score ?? "")}</span></div>${a.texte ? `<span class="muted" style="font-size:13px">${esc(a.texte)}</span>` : ""}<div class="src"><span class="s">${esc(a.source || "—")}</span>${a.date ? `<span>· ${esc(a.date)}</span>` : ""}${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">voir l'original</a>` : ""}</div></div>`).join("")}
      ${parts.map((a) => `<div class="review"><div class="row" style="justify-content:space-between"><b>${esc(a.auteur || "Particulier")}</b><span class="num">${esc(a.score ?? "")}</span></div>${a.texte ? `<span class="muted" style="font-size:13px">« ${esc(a.texte)} »</span>` : ""}<div class="src"><span class="s">${esc(a.source || "Membre de la cave")}</span>${a.date ? `<span>· ${esc(dfr(a.date))}</span>` : ""}</div></div>`).join("")}
      ${!critiques.length && !parts.length ? `<div class="muted">Pas encore d'avis.</div>` : ""}
      <div class="row"><button class="btn sm" id="b-avis">+ Ma note de dégustation</button>${v.domaine ? `<a class="btn sm" target="_blank" rel="noopener" href="https://www.vivino.com/search/wines?q=${encodeURIComponent(v.domaine + " " + (v.cuvee ?? ""))}">Avis Vivino</a>` : ""}</div></section>
    <section class="card c12"><h2>Historique de ce vin</h2><div class="tl">${mv.map((e) => evHtml(e)).join("") || `<div class="muted">Aucun mouvement.</div>`}</div></section>
  </div>`;
  $("#b-edit").onclick = () => formVin(v);
  $("#b-add").onclick = () => ajouterBouteilles(v);
  $("#b-out").onclick = () => sortir(v);
  $("#b-reval").onclick = async (e) => { e.target.disabled = true; e.target.innerHTML = '<span class="spin"></span>'; try { if (await reevaluer(v, true)) toast("Valeur mise à jour."); else if (await estimerClaude([v])) toast("Pas de cote publiée : valeur estimée."); else toast("Aucune cote trouvée : ajoutez une cote manuelle."); } catch (er) { toast("Réévaluation impossible : " + er.message); } refresh(); };
  $("#b-cote").onclick = () => coteManuelle(v);
  $("#b-avis").onclick = () => ajouterAvis(v);
  document.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => deplacer(S.d.bouteilles.find((x) => x.id === b.dataset.move))));
  document.querySelectorAll("[data-voir3d]").forEach((el) => (el.onclick = () => {
    voir3d(v.id, el.dataset.voir3d);
  }));
}
function choixEmplacement(prefix, avecAuto = false) {
  const opts = S.d.rangements.map((r) => { const c = S.d.caves.find((x) => x.id === r.cave_id); return `<option value="${r.id}">${esc(c?.nom ?? "")} · ${esc(r.nom)}</option>`; }).join("");
  return `<label class="f">Rangement<select id="${prefix}r" class="emp-r" data-p="${prefix}" data-auto="${avecAuto ? 1 : ""}"><option value="">Non rangée</option>${opts}</select></label>
    <label class="f">Rangée<select id="${prefix}l" disabled><option value="">${avecAuto ? "Auto" : "—"}</option></select></label>
    <label class="f">Colonne<select id="${prefix}c" disabled><option value="">${avecAuto ? "Auto" : "—"}</option></select></label>`;
}
document.addEventListener("change", (e) => {
  const sel = e.target.closest?.(".emp-r"); if (!sel) return;
  const p = sel.dataset.p, r = S.d.rangements.find((x) => x.id === sel.value), vide = `<option value="">${sel.dataset.auto ? "Auto" : "—"}</option>`;
  const L = $(`#${p}l`), C = $(`#${p}c`);
  if (!r || ["caisse", "vrac"].includes(r.type)) { L.innerHTML = C.innerHTML = vide; L.disabled = C.disabled = true; return; }
  const occ = new Set(S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id).map(cleB)), pr = profRg(r);
  const pleine = (l, c) => [1, 2].slice(0, pr).every((d) => occ.has(`${l}|${c}|${d}`));
  const majC = () => { const l = +L.value; C.innerHTML = vide + Array.from({ length: r.colonnes }, (_, i) => i + 1).map((c) => `<option value="${c}">${esc(labC(r, c) || c)}${l && pleine(l, c) ? " (occupée)" : l && pr > 1 && occ.has(`${l}|${c}|1`) ? " (place arrière libre)" : ""}</option>`).join(""); };
  L.innerHTML = vide + Array.from({ length: r.lignes }, (_, i) => i + 1).map((l) => { const libres = Array.from({ length: r.colonnes }, (_, i) => i + 1).reduce((n, c) => n + [1, 2].slice(0, pr).filter((d) => !occ.has(`${l}|${c}|${d}`)).length, 0); return `<option value="${l}">${esc(labL(r, l))} · ${libres} libre${libres > 1 ? "s" : ""}</option>`; }).join("");
  L.disabled = C.disabled = false; L.onchange = majC; majC();
});
function placesLibres(rid, n, l0, c0) {
  const r = S.d.rangements.find((x) => x.id === rid); if (!r) return Array(n).fill({});
  if (["caisse", "vrac"].includes(r.type)) return Array(n).fill({ rangement_id: rid });
  const occ = new Set(S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === rid).map(cleB)), pr = profRg(r);
  const res = []; let started = !l0;
  for (let l = 1; l <= r.lignes && res.length < n; l++) for (let c = 1; c <= r.colonnes && res.length < n; c++) {
    if (!started && l === l0 && c === (c0 || 1)) started = true;
    for (let d = 1; d <= pr && started && res.length < n; d++) if (!occ.has(`${l}|${c}|${d}`)) { res.push({ rangement_id: rid, ligne: l, colonne: c, emplacement: d === 2 ? ARR : null }); occ.add(`${l}|${c}|${d}`); }
  }
  while (res.length < n) res.push({});
  return res;
}
function ajouterBouteilles(v) {
  modal(`<h2>Ajouter des bouteilles</h2><div class="form"><label class="f">Quantité<input id="aq" type="number" min="1" value="1"></label><label class="f">Prix unitaire (€)<input id="ap" type="number" step="0.01" value="${v.prix_achat ?? ""}"></label><label class="f">Fournisseur<input id="af" value="${esc(v.fournisseur ?? "")}"></label>${choixEmplacement("a", true)}</div>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Ajouter</button></div>`, () => {
    $("#ok").onclick = async () => {
      const n = Math.max(1, +$("#aq").value || 1); const places = placesLibres($("#ar").value, n, +$("#al").value || 0, +$("#ac").value || 0);
      await q(sb.from(T("bouteilles")).insert(places.map((p) => ({ vin_id: v.id, ...p }))));
      await journal("entree", v, n, `Ajout de ${n} bouteille${n > 1 ? "s" : ""}${$("#af").value ? " · " + $("#af").value : ""}${$("#ap").value ? " · " + $("#ap").value + " € / btl" : ""}`, $("#ap").value ? +$("#ap").value * n : null);
      closeModal(); toast(`${n} bouteille${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.`); refresh();
    };
  });
}
function sortir(v) {
  const bs = enCave(v.id);
  modal(`<h2>Sortir une bouteille</h2><div class="form"><label class="f wide">Bouteille<select id="sb">${bs.map((b) => `<option value="${b.id}">${esc(emplacementTxt(b))}</option>`).join("")}</select></label>
    <label class="f">Motif<select id="sm">${MOTIFS.map((m) => `<option>${m}</option>`).join("")}</select></label><label class="f">Note /20 (facultatif)<input id="sn" type="number" min="0" max="20" step="0.5"></label>
    <label class="f wide">Commentaire<textarea id="sc" placeholder="Avec qui, quel plat, impressions…"></textarea></label></div>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Sortir</button></div>`, () => {
    $("#ok").onclick = async () => {
      const motif = $("#sm").value, note = $("#sn").value, com = $("#sc").value.trim();
      await q(sb.from(T("bouteilles")).update({ statut: "sortie", sortie_le: new Date().toISOString(), motif_sortie: motif, rangement_id: null, ligne: null, colonne: null }).eq("id", $("#sb").value));
      await journal("sortie", v, -1, `${motif}${note ? ` · note ${note}/20` : ""}${com ? " · " + com : ""}`, -(valU(v) ?? 0), motif);
      if (note || com) await q(sb.from(T("vins")).update({ avis: [...(v.avis || []), { type: "particulier", auteur: S.nom, score: note ? `${note}/20` : null, texte: com || null, date: new Date().toISOString(), source: "Membre de la cave" }] }).eq("id", v.id));
      closeModal(); toast("Bouteille sortie de la cave."); refresh();
    };
  });
}
function deplacer(b) {
  const v = S.d.vins.find((x) => x.id === b.vin_id);
  modal(`<h2>Déplacer la bouteille</h2><p class="muted" style="margin:0">Actuellement : ${esc(emplacementTxt(b))}</p><div class="form">${choixEmplacement("d")}<label class="f wide">Ou emplacement libre (texte)<input id="dt" placeholder="Armoire, étagère du haut…"></label></div>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Déplacer</button></div>`, () => {
    $("#ok").onclick = async () => {
      const rid = $("#dr").value || null, l = +$("#dl").value || null, c = +$("#dc").value || null;
      let emp = $("#dt").value.trim() || null;
      if (rid && l && c) {
        const pris = new Set(S.d.bouteilles.filter((x) => x.id !== b.id && x.statut === "en_cave" && x.rangement_id === rid && x.ligne === l && x.colonne === c).map((x) => (x.emplacement === ARR ? 2 : 1)));
        const d = [1, 2].slice(0, profRg(S.d.rangements.find((x) => x.id === rid))).find((k) => !pris.has(k));
        if (!d) return toast("Cette place est déjà occupée.");
        emp = d === 2 ? ARR : null;
      }
      const avant = emplacementTxt(b);
      await q(sb.from(T("bouteilles")).update({ rangement_id: rid, ligne: l, colonne: c, emplacement: emp }).eq("id", b.id));
      Object.assign(b, { rangement_id: rid, ligne: l, colonne: c, emplacement: emp });
      await journal("deplacement", v, 1, `${avant} → ${emplacementTxt(b)}`);
      closeModal(); toast("Bouteille déplacée."); refresh();
    };
  });
}
function coteManuelle(v) {
  modal(`<h2>Ajouter une cote</h2><div class="form"><label class="f">Source<input id="ms" placeholder="iDealwine, caviste, enchère…"></label><label class="f">Prix unitaire (€)<input id="mp" type="number" step="0.01"></label><label class="f wide">Lien (facultatif)<input id="mu" type="url" placeholder="https://"></label></div>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Enregistrer</button></div>`, () => {
    $("#ok").onclick = async () => {
      const prix = +$("#mp").value; const src = $("#ms").value.trim(); if (!prix || !src) return toast("Indique la source et le prix.");
      await q(sb.from(T("prix")).insert({ vin_id: v.id, source: src, detail: "Cote manuelle", prix, url: $("#mu").value.trim() || null }));
      const recents = [...S.d.prix.filter((p) => p.vin_id === v.id && p.devise === "EUR").slice(-6).map((p) => +p.prix), prix];
      const m = median(recents);
      await q(sb.from(T("vins")).update({ valeur_unitaire: m, valeur_maj: new Date().toISOString() }).eq("id", v.id));
      await journal("reevaluation", v, 0, `Cote ${src} : ${eur(prix)} · valeur retenue ${eur(m)}`, m);
      closeModal(); toast("Cote enregistrée."); refresh();
    };
  });
}
function ajouterAvis(v) {
  modal(`<h2>Ma note de dégustation</h2><div class="form"><label class="f">Note /20<input id="vn" type="number" min="0" max="20" step="0.5"></label><label class="f wide">Commentaire<textarea id="vt"></textarea></label></div>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Enregistrer</button></div>`, () => {
    $("#ok").onclick = async () => {
      const a = { type: "particulier", auteur: S.nom, score: $("#vn").value ? `${$("#vn").value}/20` : null, texte: $("#vt").value.trim() || null, date: new Date().toISOString(), source: "Membre de la cave" };
      await q(sb.from(T("vins")).update({ avis: [...(v.avis || []), a] }).eq("id", v.id)); closeModal(); toast("Note enregistrée."); refresh();
    };
  });
}
const CHAMPS = [["domaine", "Domaine", "liste"], ["cuvee", "Cuvée", "text"], ["appellation", "Appellation", "liste"], ["region", "Région", "liste"], ["pays", "Pays", "liste"], ["millesime", "Millésime", "annee"], ["couleur", "Couleur", "couleur"], ["degre", "Degré (% vol.)", "degre"], ["conditionnement", "Conditionnement", "choix"], ["gamme", "Gamme", "choix"], ["classement", "Classement", "liste"], ["maturite_debut", "Maturité dès", "garde"], ["apogee_debut", "Apogée de", "garde"], ["apogee_fin", "Apogée à", "garde"], ["declin_debut", "Déclin dès", "garde"], ["prix_achat", "Prix d'achat unitaire (€)", "number"], ["date_achat", "Date d'achat", "date"], ["fournisseur", "Fournisseur", "liste"]];
const CHOIX = {
  conditionnement: ["18,75 cl (Piccolo)", "37,5 cl (Demi-bouteille)", "50 cl (Pot / Jennie)", "62 cl (Clavelin)", "70 cl", "75 cl", "100 cl (Litre)", "150 cl (Magnum)", "300 cl (Jéroboam)", "450 cl (Réhoboam)", "600 cl (Mathusalem)", "900 cl (Salmanazar)", "1200 cl (Balthazar)", "1500 cl (Nabuchodonosor)"],
  gamme: ["Accessible", "Intermédiaire", "Premium", "Prestige"],
};
const PRESETS = {
  pays: ["France", "Italie", "Espagne", "Portugal", "Allemagne", "Autriche", "Suisse", "Hongrie", "Grèce", "Liban", "États-Unis", "Argentine", "Chili", "Afrique du Sud", "Australie", "Nouvelle-Zélande"],
  region: ["Alsace", "Beaujolais", "Bordeaux", "Bourgogne", "Champagne", "Corse", "Jura", "Languedoc", "Provence", "Roussillon", "Savoie", "Sud-Ouest", "Vallée de la Loire", "Vallée du Rhône", "Piémont", "Toscane", "Vénétie", "Rioja", "Douro", "Porto", "Mosel", "Baden", "Württemberg"],
  classement: ["Grand Cru", "Premier Cru", "Grand Cru Classé", "Premier Grand Cru Classé", "Cru Classé", "Cru Bourgeois", "Village", "Réserve", "Reserva", "Gran Reserva", "Riserva", "VDP Grosse Lage", "VDP Erste Lage"],
};
const condNorm = (v) => { if (!v) return ""; const m = String(v).replace(",", ".").match(/[\d.]+/); if (!m) return v; const cl = +m[0] < 10 ? +m[0] * 100 : +m[0]; return CHOIX.conditionnement.find((o) => +o.replace(",", ".").match(/[\d.]+/)[0] === cl) || v; };
function listeValeurs(k) { return [...new Set([...(PRESETS[k] || []), ...(S.d.vins || []).map((v) => v[k]).filter(Boolean)])].sort((a, b) => String(a).localeCompare(String(b), "fr")); }
const champInput = (k, t, val, pre = "e") => {
  if (t === "couleur") return `<select id="${pre}_${k}"><option value=""></option>${Object.entries(COUL_LIB).map(([c, l]) => `<option value="${c}" ${val === c ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  if (t === "choix") { const v0 = k === "conditionnement" ? condNorm(val) : val ?? ""; const opts = CHOIX[k].includes(v0) || !v0 ? CHOIX[k] : [v0, ...CHOIX[k]]; return `<select id="${pre}_${k}"><option value=""></option>${opts.map((o) => `<option ${o === v0 ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`; }
  if (t === "annee") return `<select id="${pre}_${k}"><option value="">Sans année</option>${Array.from({ length: NOW - 1899 }, (_, i) => NOW - i).map((y) => `<option ${+val === y ? "selected" : ""}>${y}</option>`).join("")}</select>`;
  if (t === "garde") return `<select id="${pre}_${k}"><option value="">—</option>${Array.from({ length: 111 }, (_, i) => 1950 + i).map((y) => `<option ${+val === y ? "selected" : ""}>${y}</option>`).join("")}</select>`;
  if (t === "degre") { const opts = Array.from({ length: 33 }, (_, i) => 5 + i * 0.5); const v0 = val == null || val === "" ? null : +val; return `<select id="${pre}_${k}"><option value="">—</option>${(v0 != null && !opts.includes(v0) ? [v0, ...opts] : opts).map((d) => `<option value="${d}" ${v0 === d ? "selected" : ""}>${String(d).replace(".", ",")} %</option>`).join("")}</select>`; }
  if (t === "liste") return `<input id="${pre}_${k}" list="dl_${k}" autocomplete="off" value="${esc(val ?? "")}"><datalist id="dl_${k}">${listeValeurs(k).map((o) => `<option value="${esc(o)}">`).join("")}</datalist>`;
  return `<input id="${pre}_${k}" type="${t}" ${t === "number" ? 'step="any"' : ""} value="${esc(val ?? "")}">`;
};
const lireChamps = (pre = "e") => Object.fromEntries(CHAMPS.map(([k, , t]) => { const el = $(`#${pre}_${k}`); const x = el?.value?.trim(); return [k, !x ? null : ["number", "annee", "garde", "degre"].includes(t) ? +x.replace(",", ".") : k === "conditionnement" ? x.replace(/\s*\(.*\)$/, "") : x]; }));
function formVin(v) {
  const cep = (v.cepages || []).map((g) => `${g.nom}${g.pct ? " " + g.pct : ""}`).join(", ");
  modal(`<h2>Modifier la fiche</h2><div class="form">${CHAMPS.map(([k, l, t]) => `<label class="f">${l}${champInput(k, t, v[k])}</label>`).join("")}
    <label class="f wide">Cépages (ex. Merlot 60, Cabernet Franc 40)<input id="e_cep" value="${esc(cep)}"></label>
    <label class="f wide">Service<input id="e_srv" value="${esc(v.service ?? "")}"></label>
    <label class="f wide">Notes personnelles<textarea id="e_notes">${esc(v.notes ?? "")}</textarea></label></div>
    <div class="dlg-foot"><button class="btn danger" id="del" type="button">Supprimer ce vin</button><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Enregistrer</button></div>`, () => {
    $("#ok").onclick = async () => {
      const row = lireChamps(); if (!row.domaine) return toast("Le domaine est obligatoire.");
      row.cepages = $("#e_cep").value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const m = s.match(/^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%?$/); return m ? { nom: m[1], pct: +m[2].replace(",", ".") } : { nom: s, pct: null }; });
      row.service = $("#e_srv").value.trim() || null; row.notes = $("#e_notes").value.trim() || null; row.updated_at = new Date().toISOString();
      if (["maturite_debut", "apogee_debut", "apogee_fin", "declin_debut"].some((k) => row[k] !== v[k])) row.garde_source = "Saisie manuelle";
      await q(sb.from(T("vins")).update(row).eq("id", v.id));
      await journal("modification", { ...v, ...row }, 0, "Fiche modifiée");
      closeModal(); toast("Fiche enregistrée."); refresh();
    };
    $("#del").onclick = async () => {
      if ($("#del").dataset.sure !== "1") { $("#del").dataset.sure = "1"; $("#del").textContent = "Confirmer : supprimer définitivement"; return; }
      await q(sb.from(T("vins")).delete().eq("id", v.id)); closeModal(); toast("Vin supprimé."); go("vins"); refresh();
    };
  });
}

/* ---------------- Scan ---------------- */
let SCAN = { mode: "etiquette", fichiers: [], res: null, base: {} };
function compresser(file, max = 1600) {
  return new Promise((ok, ko) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const k = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob((b) => ok(b), "image/jpeg", 0.85); };
    img.onerror = ko; img.src = url;
  });
}
const b64 = (blob) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(blob); });
function vScan() {
  $("#view").innerHTML = `<div class="head"><div><div class="eyebrow">Ajouter une bouteille</div><h1>Scan</h1></div><div class="seg" id="smode">${[["etiquette", "Étiquette"], ["codebarre", "Code-barres"], ["recherche", "Recherche"], ["saisie", "Saisie"]].map(([k, l]) => `<button data-m="${k}" aria-pressed="${SCAN.mode === k}">${l}</button>`).join("")}</div></div><div id="scz"></div>`;
  $("#smode").onclick = (e) => { const b = e.target.closest("button"); if (b) { SCAN = { mode: b.dataset.m, fichiers: [], res: null, base: {} }; vScan(); } };
  const z = $("#scz");
  if (SCAN.res || SCAN.mode === "saisie") return formulaireAjout(z);
  if (SCAN.mode === "etiquette") {
    z.innerHTML = `<div class="grid"><section class="card c5"><div class="viewfinder" style="max-height:420px">${SCAN.fichiers[0] ? `<img src="${URL.createObjectURL(SCAN.fichiers[0])}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<img src="img/scan-demo.jpg" alt="" class="vf-demo"><div class="vf-txt"><div style="font-family:var(--display);font-size:20px;font-weight:600">Photographie l'étiquette</div><div style="opacity:.8;font-size:13px">Face, puis contre-étiquette si possible</div></div>`}<span class="corner" style="top:16px;left:16px;border-right:0;border-bottom:0;border-radius:10px 0 0 0"></span><span class="corner" style="top:16px;right:16px;border-left:0;border-bottom:0;border-radius:0 10px 0 0"></span><span class="corner" style="bottom:16px;left:16px;border-right:0;border-top:0;border-radius:0 0 0 10px"></span><span class="corner" style="bottom:16px;right:16px;border-left:0;border-top:0;border-radius:0 0 10px 0"></span>${SCAN.fichiers.length ? "" : '<span class="scanline"></span>'}</div>
      <div class="preview">${SCAN.fichiers.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join("")}</div>
      <div class="row" style="justify-content:center"><label class="btn primary" style="cursor:pointer">Prendre une photo<input type="file" accept="image/*" capture="environment" id="cam" hidden></label><label class="btn" style="cursor:pointer">Galerie<input type="file" accept="image/*" multiple id="gal" hidden></label></div></section>
      <section class="card c7"><h2>Lecture automatique</h2><p class="muted" style="margin:0">Ajoute jusqu'à 4 photos (étiquette, contre-étiquette, capsule). Les informations lues sont comparées avec les sources en ligne, et toutes les photos sont conservées.</p>
      <div class="row"><button class="btn primary" id="go" ${SCAN.fichiers.length ? "" : "disabled"}>Analyser ${SCAN.fichiers.length ? `${SCAN.fichiers.length} photo${SCAN.fichiers.length > 1 ? "s" : ""}` : ""}</button>${SCAN.fichiers.length ? `<button class="btn" id="raz">Recommencer</button>` : ""}</div><div id="etat"></div></section></div>`;
    const add = (e) => { SCAN.fichiers = [...SCAN.fichiers, ...e.target.files].slice(0, 4); vScan(); };
    $("#cam").onchange = add; $("#gal").onchange = add;
    if ($("#raz")) $("#raz").onclick = () => { SCAN.fichiers = []; vScan(); };
    $("#go").onclick = analyser;
  } else if (SCAN.mode === "codebarre") {
    z.innerHTML = `<section class="card"><h2>Code-barres</h2><p class="muted" style="margin:0">Photographie le code-barres ou tape-le. Les vins sont peu référencés par code-barres : le scan d'étiquette reste plus fiable.</p>
      <div class="row"><input id="ean" inputmode="numeric" placeholder="3 760 …" style="max-width:260px"><label class="btn" style="cursor:pointer">Photo du code<input type="file" accept="image/*" capture="environment" id="eanp" hidden></label><button class="btn primary" id="eango">Chercher</button></div><div id="etat"></div></section>`;
    $("#eanp").onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      $("#etat").innerHTML = '<span class="spin"></span>';
      let code = null;
      try { if ("BarcodeDetector" in window) { const r = await new window.BarcodeDetector().detect(await createImageBitmap(f)); code = r[0]?.rawValue || null; } } catch {}
      if (!code) {
        // iPhone (Safari) n'a pas BarcodeDetector : lecture avec ZXing
        const url = URL.createObjectURL(f);
        try { const Z = await import("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm"); const res = await new Z.BrowserMultiFormatReader().decodeFromImageUrl(url); code = res?.getText?.() || null; } catch {}
        URL.revokeObjectURL(url);
      }
      $("#etat").innerHTML = "";
      if (code) { $("#ean").value = code; $("#eango").click(); } else toast("Aucun code-barres détecté : rapproche-toi ou tape le numéro.");
    };
    $("#eango").onclick = async () => {
      const code = $("#ean").value.replace(/\D/g, ""); if (code.length < 8) return toast("Code-barres incomplet.");
      $("#etat").innerHTML = '<span class="spin"></span>';
      try {
        const r = await (await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,origins,countries,quantity,alcohol_value,image_front_url`)).json();
        if (r.status !== 1) { $("#etat").innerHTML = `<p class="muted">Code ${esc(code)} inconnu d'Open Food Facts (les vins y sont peu référencés). Le scan d'étiquette est plus fiable.</p><button class="btn primary" data-act="scan-etiquette">Scanner l'étiquette</button>`; return; }
        const p = r.product; SCAN.res = { source: "Open Food Facts", etiquette: { domaine: { valeur: p.brands || p.product_name, confiance: 60 }, cuvee: { valeur: p.product_name, confiance: 60 }, conditionnement: { valeur: p.quantity, confiance: 60 }, degre: { valeur: p.alcohol_value, confiance: 60 }, code_barres: { valeur: code, confiance: 100 } }, estimation: {} };
        vScan();
      } catch { $("#etat").innerHTML = `<p class="err">Open Food Facts ne répond pas.</p>`; }
    };
  } else if (SCAN.mode === "recherche") {
    z.innerHTML = `<section class="card"><h2>Rechercher un vin</h2><div class="row"><input id="rq" placeholder="Château Margaux 2015"><button class="btn primary" id="rgo">Chercher</button></div><div id="etat"></div></section>`;
    const go2 = async () => {
      $("#etat").innerHTML = '<span class="spin"></span>';
      try {
        const r = await callFn("vin", { action: "search", q: $("#rq").value });
        const res = r?.results || [];
        $("#etat").innerHTML = res.length ? `<div class="list">${res.map((w, i) => `<button class="li" data-i="${i}" style="grid-template-columns:1fr auto"><span><b>${esc(w.name)}</b> ${w.vintage ?? ""}<br><span class="muted" style="font-size:12px">${esc([w.winery, w.region, w.country].filter(Boolean).join(" · "))}</span></span><span class="muted">${w.averageRating ? w.averageRating + "/5" : ""}</span></button>`).join("")}</div><div class="src">Source : <span class="s">wineapi.io</span></div>` : `<p class="muted">Aucun résultat. Passe en saisie manuelle.</p>`;
        document.querySelectorAll("#etat [data-i]").forEach((b) => (b.onclick = async () => {
          const w = res[+b.dataset.i]; $("#etat").innerHTML = '<span class="spin"></span>';
          const d = await callFn("vin", { action: "details", id: w.id });
          SCAN.res = { etiquette: {}, estimation: {}, wineapi: d, sources: { wineapi: "wineapi.io" } }; vScan();
        }));
      } catch (e) { $("#etat").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    };
    $("#rgo").onclick = go2; $("#rq").onkeydown = (e) => e.key === "Enter" && go2();
  }
}
async function analyser() {
  const etat = $("#etat"); $("#go").disabled = true;
  etat.innerHTML = `<div class="row"><span class="spin"></span><span class="muted">Lecture de l'étiquette et recherche des informations…</span></div>`;
  try {
    SCAN.blobs = await Promise.all(SCAN.fichiers.map((f) => compresser(f)));
    const images = await Promise.all(SCAN.blobs.map(async (b) => ({ data: await b64(b), type: "image/jpeg" })));
    SCAN.res = await callFn("scan", { images });
    vScan();
  } catch (e) { etat.innerHTML = `<p class="err">Analyse impossible : ${esc(e.message)}. Tu peux passer en saisie manuelle.</p>`; $("#go").disabled = false; }
}
function depuisWineapi(w) {
  if (!w) return {};
  const coul = { red: "rouge", white: "blanc", rose: "rose", rosé: "rose", sparkling: "effervescent", dessert: "liquoreux", fortified: "liquoreux" }[String(w.type || "").toLowerCase()];
  return { domaine: w.winery?.name, cuvee: w.name, appellation: w.appellation, region: w.region?.name, pays: w.region?.country, millesime: w.vintage, couleur: coul, degre: w.alcoholContent, classement: w.classification };
}
function formulaireAjout(z) {
  const r = SCAN.res || { etiquette: {}, estimation: {} };
  const et = r.etiquette || {}, es = r.estimation || {}, wa = depuisWineapi(r.wineapi);
  const lignes = CHAMPS.slice(0, 11).map(([k, l, t]) => {
    const lu = et[k]?.valeur ?? null, conf = et[k]?.confiance ?? 0, src = wa[k] ?? (k === "gamme" ? es.gamme : null);
    const val = lu ?? src ?? "";
    const conflit = lu != null && src != null && String(lu).toLowerCase().trim() !== String(src).toLowerCase().trim();
    return `<div class="muted">${l}</div><div>${lu != null ? esc(lu) + `<span class="conf ${conf >= 85 ? "ok" : "mid"}">lu ${conf} %</span>` : '<span class="muted">—</span>'}</div><div style="color:var(--wine)">${src != null ? esc(src) : '<span class="muted">—</span>'}${conflit ? `<div class="conflict">Écart avec l'étiquette</div>` : ""}</div><div>${champInput(k, t, val, "n")}</div>`;
  }).join("");
  const garde = [["maturite_debut", "Maturité dès"], ["apogee_debut", "Apogée de"], ["apogee_fin", "Apogée à"], ["declin_debut", "Déclin dès"]];
  const cep = (r.wineapi?.grapes?.length ? r.wineapi.grapes.map((g) => ({ nom: g.name, pct: null })) : es.cepages || []);
  const scores = r.wineapi?.scores || [];
  const prix = (r.wineapi?.prices || []).filter((p) => p.price != null);
  z.innerHTML = `<div class="grid">
    <section class="card c8"><div class="row" style="justify-content:space-between"><h2>${SCAN.mode === "saisie" ? "Saisie manuelle" : "Lu sur l'étiquette / Complété automatiquement"}</h2>${r.duree_ms ? `<span class="chip">${(r.duree_ms / 1000).toFixed(1)} s</span>` : ""}</div>
      ${SCAN.mode === "saisie" && !SCAN.res ? `<div class="form">${CHAMPS.slice(0, 11).map(([k, l, t]) => `<label class="f">${l}${champInput(k, t, "", "n")}</label>`).join("")}</div>` :
      `<div style="overflow-x:auto"><div class="cmp" style="grid-template-columns:110px 1fr 1fr 1.2fr;min-width:560px"><div class="h">Champ</div><div class="h">Étiquette</div><div class="h">${esc(r.source || (r.wineapi ? "wineapi.io" : "Sources"))}</div><div class="h">Valeur retenue</div>${lignes}</div></div>
      <div class="src">Sources :${r.sources?.etiquette ? `<span class="s">${esc(r.sources.etiquette)}</span>` : ""}${r.wineapi ? `<span class="s">wineapi.io${r.wineapi_confiance ? " · confiance " + Math.round(r.wineapi_confiance * (r.wineapi_confiance <= 1 ? 100 : 1)) + " %" : ""}</span>` : `<span>· vin non trouvé sur wineapi.io</span>`}${r.source ? `<span class="s">${esc(r.source)}</span>` : ""}</div>
      <div class="note">L'étiquette fait foi : en cas d'écart, la valeur lue est proposée par défaut. Tu peux tout corriger.</div>`}
      <h2>Garde</h2><div class="form">${garde.map(([k, l]) => `<label class="f">${l}${champInput(k, "garde", es[k], "n")}</label>`).join("")}</div>
      ${es.apogee_debut ? `<div class="src">Source : <span class="s">${esc(r.sources?.estimation || "Estimation Claude")}</span></div>` : ""}
      <label class="f">Cépages<input id="n_cep" value="${esc(cep.map((g) => g.nom + (g.pct ? " " + g.pct : "")).join(", "))}"></label>
      <label class="f">Accords (un par ligne)<textarea id="n_acc">${esc([...(r.wineapi?.pairings || []).map((p) => p.food), ...(es.accords || []).map((a) => a.plat)].join("\n"))}</textarea></label>
      ${scores.length ? `<div><div class="eyebrow">Scores critiques trouvés</div>${scores.map((s) => `<div class="row" style="justify-content:space-between"><span>${esc(s.reviewer || "Critique")}</span><span class="num">${esc(s.scoreText || s.score)}</span></div>`).join("")}</div>` : ""}
      ${prix.length ? `<div><div class="eyebrow">Prix trouvés</div>${prix.slice(0, 5).map((p) => `<div class="row" style="justify-content:space-between"><span>${esc(p.merchantName || "Marchand")}</span><span class="num">${p.price} ${esc(p.currency)}</span></div>`).join("")}</div>` : ""}
    </section>
    <section class="card c4"><h2>Achat et rangement</h2><div class="form" style="grid-template-columns:1fr 1fr">
      <label class="f">Quantité<input id="n_q" type="number" min="1" value="1"></label><label class="f">Prix unitaire (€)<input id="n_prix_achat" type="number" step="0.01"></label>
      <label class="f">Date d'achat<input id="n_date_achat" type="date" value="${new Date().toISOString().slice(0, 10)}"></label><label class="f">Fournisseur<input id="n_fournisseur" list="dl_fournisseur" autocomplete="off"><datalist id="dl_fournisseur">${listeValeurs("fournisseur").map((o) => `<option value="${esc(o)}">`).join("")}</datalist></label>
      ${choixEmplacement("n", true)}</div>
      ${SCAN.blobs?.length ? `<div class="preview">${SCAN.blobs.map((b) => `<img src="${URL.createObjectURL(b)}" alt="">`).join("")}</div><div class="muted" style="font-size:12px">Les ${SCAN.blobs.length} photos seront conservées avec la fiche.</div>` : ""}
      <button class="btn primary" id="save">Ajouter à la cave</button><button class="btn" id="cancel">Annuler</button></section></div>`;
  $("#cancel").onclick = () => { SCAN = { mode: SCAN.mode, fichiers: [], res: null }; vScan(); };
  $("#save").onclick = enregistrerScan;
}
async function enregistrerScan() {
  const btn = $("#save"); btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  try {
    const r = SCAN.res || { etiquette: {}, estimation: {} }; const es = r.estimation || {}; const w = r.wineapi;
    const row = lireChamps("n"); if (!row.domaine) { btn.disabled = false; btn.textContent = "Ajouter à la cave"; return toast("Le domaine est obligatoire."); }
    ["maturite_debut", "apogee_debut", "apogee_fin", "declin_debut"].forEach((k) => { const x = $(`#n_${k}`).value; row[k] = x ? +x : null; });
    row.garde_source = row.apogee_debut ? (es.apogee_debut && +es.apogee_debut === row.apogee_debut ? r.sources?.estimation || "Estimation Claude" : "Saisie manuelle") : null;
    row.cepages = $("#n_cep").value.split(",").map((s) => s.trim()).filter(Boolean).map((s) => { const m = s.match(/^(.*?)\s*(\d+(?:[.,]\d+)?)\s*%?$/); return m ? { nom: m[1], pct: +m[2].replace(",", ".") } : { nom: s, pct: null }; });
    const accW = new Set((w?.pairings || []).map((p) => p.food));
    row.accords = $("#n_acc").value.split("\n").map((s) => s.trim()).filter(Boolean).map((p) => ({ plat: p, note: (es.accords || []).find((a) => a.plat === p)?.note || null, source: accW.has(p) ? "wineapi.io" : (es.accords || []).some((a) => a.plat === p) ? "Estimation Claude" : "Saisie manuelle" }));
    row.service = es.service || null; row.description = w?.description || es.description || null;
    row.wineapi_id = w?.id || null; row.lwin = w?.lwinCode || null;
    row.avis = (w?.scores || []).map((s) => ({ type: "critique", auteur: s.reviewer, score: s.scoreText || s.score, date: s.reviewDate, source: "wineapi.io" }));
    if (w?.averageRating) row.avis.push({ type: "particulier", auteur: `Moyenne de ${w.ratingsCount ?? "?"} avis`, score: `${w.averageRating}/5`, source: "wineapi.io (agrégat d'avis)" });
    row.lecture_etiquette = r.etiquette || null;
    const eurPrix = (w?.prices || []).filter((p) => p.currency === "EUR" && p.price != null).map((p) => +p.price);
    if (eurPrix.length) { row.valeur_unitaire = median(eurPrix); row.valeur_maj = new Date().toISOString(); row.valeur_sources = (w.prices || []).slice(0, 8).map((p) => ({ source: "wineapi.io", detail: p.merchantName, prix: +p.price, devise: p.currency, url: p.url })); }
    const [vin] = await q(sb.from(T("vins")).insert(row).select());
    const n = Math.max(1, +$("#n_q").value || 1);
    const places = placesLibres($("#nr").value, n, +$("#nl").value || 0, +$("#nc").value || 0);
    await q(sb.from(T("bouteilles")).insert(places.map((p) => ({ vin_id: vin.id, ...p }))));
    if (w?.prices?.length) await q(sb.from(T("prix")).insert(w.prices.filter((p) => p.price != null).map((p) => ({ vin_id: vin.id, source: "wineapi.io", detail: p.merchantName, prix: +p.price, devise: p.currency || "EUR", url: p.url, releve_le: p.fetchedAt || new Date().toISOString() }))));
    if (SCAN.blobs?.length) {
      const chemins = [];
      for (let i = 0; i < SCAN.blobs.length; i++) {
        const chemin = `${S.user.id}/${vin.id}/${Date.now()}-${i}.jpg`;
        const { error } = await sb.storage.from("etiquettes").upload(chemin, SCAN.blobs[i], { contentType: "image/jpeg" });
        if (!error) chemins.push(chemin);
      }
      if (chemins.length) {
        await q(sb.from(T("photos")).insert(chemins.map((c, i) => ({ vin_id: vin.id, chemin: c, type: i === 0 ? "etiquette" : "contre-etiquette" }))));
        await q(sb.from(T("vins")).update({ photo_principale: chemins[0] }).eq("id", vin.id));
      }
    }
    await journal("entree", vin, n, `${SCAN.mode === "etiquette" ? "Scan" : SCAN.mode === "saisie" ? "Saisie" : "Recherche"} · ${places[0]?.rangement_id ? emplacementTxt({ ...places[0], statut: "en_cave" }) : "non rangée"}${row.fournisseur ? " · " + row.fournisseur : ""}`, row.prix_achat ? row.prix_achat * n : null);
    SCAN = { mode: "etiquette", fichiers: [], res: null };
    toast(`${n} bouteille${n > 1 ? "s" : ""} ajoutée${n > 1 ? "s" : ""}.`);
    await charger(); go("vin-" + vin.id);
  } catch (e) { btn.disabled = false; btn.textContent = "Ajouter à la cave"; toast("Enregistrement impossible : " + e.message); }
}

/* ---------------- Journal ---------------- */
const EVT = { entree: ["in", "+"], sortie: ["out", "−"], deplacement: ["mv", "↦"], reevaluation: ["mv", "€"], modification: ["mv", "✎"] };
function evHtml(e) {
  const [cls, sym] = EVT[e.type] || ["mv", "·"];
  const qn = e.type === "entree" ? `+${e.quantite}` : e.type === "sortie" ? `${e.quantite}` : sym;
  return `<div class="ev"><span class="d muted num" style="font-size:12px">${new Date(e.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span><span class="ic ${cls}">${esc(qn)}</span><span>${e.vin_id ? `<a href="#vin-${e.vin_id}" style="color:inherit"><b>${esc(e.vin_libelle ?? "")}</b></a>` : `<b>${esc(e.vin_libelle ?? "")}</b>`}<br><span class="muted">${esc(e.detail ?? "")}</span></span><span class="v num ${e.valeur > 0 ? "up" : e.valeur < 0 ? "down" : ""}">${e.valeur && e.type !== "reevaluation" ? (e.valeur > 0 ? "+" : "") + eur(e.valeur) : ""}</span></div>`;
}
function vJournal() {
  const f = S.ui.jfiltre; const all = S.d.mouvements.slice().reverse(); const ev = all.filter((e) => !f || e.type === f);
  const m0 = new Date(); m0.setDate(1); m0.setHours(0, 0, 0, 0);
  const mois = all.filter((e) => new Date(e.created_at) >= m0);
  const ent = mois.filter((e) => e.type === "entree").reduce((s, e) => s + e.quantite, 0), sor = -mois.filter((e) => e.type === "sortie").reduce((s, e) => s + e.quantite, 0);
  $("#view").innerHTML = `<div class="head"><div><div class="eyebrow">Toutes les caves</div><h1>Journal d'activité</h1></div><div class="seg" id="jf">${[["", "Tout"], ["entree", "Entrées"], ["sortie", "Sorties"], ["deplacement", "Déplacements"], ["reevaluation", "Valeurs"]].map(([k, l]) => `<button data-f="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div></div>
  <div class="grid"><section class="card c3"><div class="eyebrow">${m0.toLocaleDateString("fr-FR", { month: "long" })}</div><div class="big up">+${ent}</div><div class="muted">bouteilles entrées</div><div class="big down" style="margin-top:8px">−${sor}</div><div class="muted">bouteilles sorties</div></section>
  <section class="card" style="grid-column:span 9"><div class="tl">${ev.map(evHtml).join("") || `<div class="muted">Aucun mouvement pour l'instant.</div>`}</div><button class="btn" id="csv" style="align-self:flex-start">Exporter CSV</button></section></div>`;
  $("#jf").onclick = (e) => { const b = e.target.closest("button"); if (b) { S.ui.jfiltre = b.dataset.f; vJournal(); } };
  $("#csv").onclick = () => {
    const rows = [["date", "type", "vin", "quantite", "detail", "valeur"], ...ev.map((e) => [e.created_at, e.type, e.vin_libelle ?? "", e.quantite, e.detail ?? "", e.valeur ?? ""])];
    const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = `journal-cave-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
}

/* ---------------- Compte ---------------- */
function vCompte() {
  $("#view").innerHTML = `<div class="head"><div><div class="eyebrow">Compte</div><h1>${esc(S.nom)}</h1></div></div>
  <div class="grid"><section class="card c6"><h2>Changer le mot de passe</h2><form id="fmdp" class="stack"><label class="f">Nouveau mot de passe<input id="m1" type="password" minlength="10" autocomplete="new-password" required></label><label class="f">Confirmer<input id="m2" type="password" autocomplete="new-password" required></label><div class="err" id="merr"></div><button class="btn primary">Enregistrer</button></form></section>
  <section class="card c6"><h2>Session</h2><p class="muted" style="margin:0">Identifiant : <span class="num">${esc(S.slug)}</span></p><button class="btn" id="out">Se déconnecter</button>
  <div class="note">Astuce : sur téléphone, « Ajouter à l'écran d'accueil » installe Cave comme une application.</div></section>
  <section class="card c12" id="parrain"><h2>Parrainage</h2><p class="muted" style="margin:0">Crée un code à donner de vive voix, par message ou sur un groupe. La personne choisit son identifiant et son mot de passe, et sa cave est créée aussitôt.</p>
    <form id="fpar" class="par-form">
      <label class="f">Libellé (facultatif)<input id="parnote" placeholder="ex. Club œno, famille, Marie…" maxlength="80"></label>
      <label class="f">Nombre d'inscriptions<select id="parplaces"><option value="1">1 personne</option><option value="5">5 personnes</option><option value="10" selected>10 personnes</option><option value="50">50 personnes</option><option value="500">Sans limite</option></select></label>
      <label class="f">Valable<select id="parjours"><option value="30">30 jours</option><option value="90" selected>3 mois</option><option value="365">1 an</option></select></label>
      <button class="btn primary">Créer un code</button></form>
    <div id="parlien"></div><div id="parliste" class="stack" style="gap:6px"></div></section></div>`;
  $("#fmdp").onsubmit = async (e) => {
    e.preventDefault(); const a = $("#m1").value, b = $("#m2").value;
    if (a !== b) return ($("#merr").textContent = "Les deux mots de passe sont différents.");
    if (a.length < 10) return ($("#merr").textContent = "10 caractères minimum.");
    const { error } = await sb.auth.updateUser({ password: a, data: { doit_changer_mdp: false } });
    if (error) return ($("#merr").textContent = error.message);
    S.user.user_metadata.doit_changer_mdp = false; e.target.reset(); toast("Mot de passe modifié.");
  };
  $("#out").onclick = async () => { await sb.auth.signOut(); S = { ...S, user: null, d: {} }; vueLogin(); };
  parrainage();
  vConso();
}

/* ---------------- Parrainage ---------------- */
const lienInvit = (code) => `${location.origin}${location.pathname}#invitation-${code}`;
const codeAff = (c) => c.toUpperCase().replace(/^(.{4})(.+)$/, "$1-$2");
const regPar = (note) => { try { const j = JSON.parse(note); if (j && typeof j === "object") return { libelle: j.l || null, max: +j.max || 1, enfant: !!j.enfant }; } catch {} return { libelle: note, max: 1, enfant: false }; };
async function parrainage() {
  const partager = async (code) => {
    const url = lienInvit(code), txt = `${S.nom} t'invite sur Cave, l'app pour gérer sa cave à vin. Ton code de parrainage : ${codeAff(code)}`;
    try { if (navigator.share) { await navigator.share({ title: "Cave", text: txt, url }); return; } } catch {}
    try { await navigator.clipboard.writeText(`${txt}\n${url}`); toast("Code et lien copiés."); } catch { prompt("Copie ce lien :", url); }
  };
  const liste = async () => {
    const z = $("#parliste"); if (!z) return;
    const { data, error } = await sb.from("parrainages").select("*").order("cree_le", { ascending: false }).limit(300);
    if (error) { z.innerHTML = `<div class="muted" style="font-size:13px">Les codes s'afficheront ici.</div>`; return; }
    const parents = (data || []).filter((p) => !p.code.includes("~") && !regPar(p.note).enfant);
    const total = data.filter((x) => x.filleul_slug || x.filleul_nom).length;
    z.innerHTML = (total ? `<div class="muted" style="font-size:13px">${total} personne${total > 1 ? "s" : ""} parrainée${total > 1 ? "s" : ""} au total</div>` : "") + parents.map((p) => {
      const r = regPar(p.note), enf = data.filter((x) => x.code.startsWith(p.code + "~"));
      const noms = [...(p.filleul_nom ? [p.filleul_nom] : []), ...enf.map((x) => x.filleul_nom || x.filleul_slug)];
      const filleuls = [...(p.filleul_nom || p.filleul_slug ? [p] : []), ...enf.filter((x) => x.filleul_nom || x.filleul_slug)];
      const exp = new Date(p.expire_le) < new Date(), plein = noms.length >= r.max;
      const etat = plein ? `<span class="chip">Complet</span>` : exp ? `<span class="chip">Expiré</span>` : `<span class="chip ok">Actif</span>`;
      return `<div class="par-li"><div class="par-code num">${codeAff(p.code)}</div>
        <div class="par-info"><b>${esc(r.libelle || "Code de parrainage")}</b><small>${r.max >= 500 ? `${noms.length} inscrit${noms.length > 1 ? "s" : ""}` : `${noms.length}/${r.max} inscrit${r.max > 1 ? "s" : ""}`} · jusqu'au ${dfr(p.expire_le)}${noms.length ? ` · ${esc(noms.slice(0, 4).join(", "))}${noms.length > 4 ? "…" : ""}` : ""}</small></div>
        <div class="par-act">${etat}${!plein && !exp ? `<button class="btn sm" data-part="${esc(p.code)}">Partager</button>` : ""}</div>${filleuls.length ? `<ul class="par-fil">${filleuls.map((x) => `<li><b>${esc(x.filleul_nom || x.filleul_slug)}</b>${[x.filleul_slug && x.filleul_nom ? "identifiant " + x.filleul_slug : "", x.utilise_le ? "inscrit le " + dfr(x.utilise_le) : ""].filter(Boolean).map((t) => `<span class="muted"> · ${esc(t)}</span>`).join("")}</li>`).join("")}</ul>` : ""}</div>`;
    }).join("") || `<div class="muted" style="font-size:13px">Aucun code pour l'instant.</div>`;
    z.querySelectorAll("[data-part]").forEach((b) => (b.onclick = () => partager(b.dataset.part)));
  };
  $("#fpar").onsubmit = async (e) => {
    e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      const places = +$("#parplaces").value;
      const r = { places, ...(await callFn("parrainage", { action: "creer", note: $("#parnote").value.trim(), places, jours: +$("#parjours").value })) };
      $("#parlien").innerHTML = `<div class="par-nouveau"><div><small>Ton code</small><div class="num">${codeAff(r.code)}</div><small>${r.places >= 500 ? "Sans limite d'inscriptions" : r.places + " inscription" + (r.places > 1 ? "s" : "")} · à saisir sur la page de connexion, ou via le lien</small></div><button class="btn primary" id="parcopie">Partager</button></div>`;
      $("#parcopie").onclick = () => partager(r.code); $("#parnote").value = ""; liste();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  };
  liste();
}
async function vueInvitation(code) {
  $("#app").innerHTML = `<div class="login"><div class="side"></div><div class="panel"><div class="brand" style="padding:0"><i></i>Cave</div><div id="inv" class="stack"><div class="muted">Vérification de l'invitation…</div></div></div></div>`;
  let v; try { v = await callFn("parrainage", { action: "verifier", code }); } catch (e) { v = { ok: false, raison: e.message }; }
  const z = $("#inv");
  if (!v.ok) { z.innerHTML = `<h1>Invitation</h1><p class="muted">${esc(v.raison || "Lien invalide.")}</p><a class="btn" href="./">Retour à la connexion</a>`; return; }
  z.innerHTML = `<div><h1>Bienvenue</h1><p class="muted" style="margin:4px 0 0">${esc(v.parrain)} t'invite à gérer ta cave, bouteille par bouteille.</p></div>
    <form id="finv" class="stack">
      <label class="f">Ton nom<input id="inom" autocomplete="name" required maxlength="60" placeholder="Prénom Nom"></label>
      <label class="f">Identifiant de connexion<input id="iid" autocomplete="username" autocapitalize="none" required pattern="[a-z][a-z0-9_]{2,30}" placeholder="ex. marie"><span class="muted" style="font-size:12px">Lettres minuscules, chiffres ou _, 3 caractères minimum.</span></label>
      <label class="f">Mot de passe<input id="imdp" type="password" autocomplete="new-password" minlength="10" required></label>
      <label class="f">Confirme le mot de passe<input id="imdp2" type="password" autocomplete="new-password" minlength="10" required></label>
      <div class="err" id="ierr"></div>
      <button class="btn primary" type="submit">Créer mon compte</button>
    </form>`;
  $("#inom").oninput = () => { const i = $("#iid"); if (!i.dataset.touche) i.value = sansAccent($("#inom").value).split(" ")[0].replace(/[^a-z0-9_]/g, "").slice(0, 31); };
  $("#iid").oninput = (e) => (e.target.dataset.touche = "1");
  $("#finv").onsubmit = async (e) => {
    e.preventDefault(); const err = $("#ierr"); err.textContent = "";
    const id = $("#iid").value.trim().toLowerCase(), mdp = $("#imdp").value;
    if (mdp !== $("#imdp2").value) return (err.textContent = "Les deux mots de passe sont différents.");
    if (mdp.length < 10) return (err.textContent = "10 caractères minimum.");
    const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Création de ta cave…";
    try {
      await callFn("parrainage", { action: "inscrire", code, identifiant: id, nom: $("#inom").value.trim(), mot_de_passe: mdp });
      const { error } = await sb.auth.signInWithPassword({ email: `${id}@${CFG.domaineIdentifiant}`, password: mdp });
      if (error) throw new Error("Compte créé. Connecte-toi avec ton identifiant.");
      history.replaceState(null, "", location.pathname); demarrer();
    } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = "Créer mon compte"; }
  };
}

/* ---------------- Consommation (refacturation) ---------------- */
const estAdmin = () => S.user?.app_metadata?.admin === true;
const moisCle = (d) => new Date(d).toISOString().slice(0, 7);
const moisLib = (k) => { const [a, m] = k.split("-"); return new Date(+a, +m - 1, 1).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }); };
const eur2 = (n) => (n ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function chargerConso(depuis) {
  const [c, p] = await Promise.all([
    sb.from("consommation").select("*").gte("created_at", depuis.toISOString()).order("created_at").limit(50000),
    sb.from("parametres").select("*"),
  ]);
  if (c.error) throw c.error;
  const par = Object.fromEntries((p.data || []).map((x) => [x.cle, x.valeur]));
  return { lignes: c.data, taux: Number(par.taux_usd_eur ?? 0.86), forfait: Number(par.wineapi_forfait_eur ?? 0) };
}
function bilan(lignes, mois, taux, forfait) {
  const l = lignes.filter((x) => moisCle(x.created_at) === mois);
  const par = {};
  for (const x of l) {
    const p = (par[x.slug] ??= { slug: x.slug, scans: 0, wineapi: 0, jetons: 0, claude_eur: 0 });
    if (x.service === "claude") { p.scans++; p.jetons += x.jetons_entree + x.jetons_sortie; p.claude_eur += Number(x.cout_usd) * taux; }
    else p.wineapi++;
  }
  const tot = Object.values(par).reduce((s, p) => s + p.wineapi, 0);
  for (const p of Object.values(par)) { p.wineapi_eur = tot ? (forfait * p.wineapi) / tot : 0; p.total = p.claude_eur + p.wineapi_eur; }
  return Object.values(par).sort((a, b) => b.total - a.total || b.scans - a.scans);
}
function recapTexte(rows, mois) {
  const lignes = rows.map((r) => `- ${r.slug} : ${r.scans} scan(s), ${r.wineapi} appel(s) wineapi → ${eur2(r.total)}`);
  return `Cave — consommation de ${moisLib(mois)}\n${lignes.join("\n") || "Aucune consommation."}\nTotal : ${eur2(rows.reduce((s, r) => s + r.total, 0))} (avancé par l’administrateur)`;
}
async function vConso() {
  const box = document.createElement("div"); box.className = "grid"; box.style.marginTop = "16px"; $("#view").appendChild(box);
  const debut = new Date(); debut.setMonth(debut.getMonth() - 11, 1); debut.setHours(0, 0, 0, 0);
  let D; try { D = await chargerConso(debut); } catch (e) { box.innerHTML = `<section class="card c12"><h2>Consommation</h2><p class="muted">Suivi indisponible : ${esc(e.message)}</p></section>`; return; }
  const moisDispo = [...new Set([moisCle(new Date()), ...D.lignes.map((x) => moisCle(x.created_at))])].sort().reverse();
  S.ui.mois ??= moisDispo[0];
  const rendre = () => {
    const rows = bilan(D.lignes, S.ui.mois, D.taux, D.forfait);
    const moi = rows.find((r) => r.slug === S.slug) || { scans: 0, wineapi: 0, total: 0 };
    const sel = `<select id="cmois">${moisDispo.map((m) => `<option value="${m}" ${m === S.ui.mois ? "selected" : ""}>${moisLib(m)}</option>`).join("")}</select>`;
    let html = `<section class="card ${estAdmin() ? "c4" : "c12"}"><h2>Ma consommation</h2>${sel}
      <div class="stack" style="margin-top:12px"><div><span class="num" style="font-size:28px">${eur2(moi.total)}</span></div>
      <p class="muted" style="margin:0">${moi.scans} scan(s) d'étiquette · ${moi.wineapi} recherche(s) wineapi</p>
      <div class="note">Les frais sont avancés par l’administrateur et refacturés chaque mois. Source : coût réel des appels Claude (Haiku 5.5) et quote-part du forfait wineapi.io.</div></div></section>`;
    if (estAdmin()) {
      const tot = rows.reduce((s, r) => s + r.total, 0);
      html += `<section class="card c8"><h2>Refacturation · ${esc(moisLib(S.ui.mois))}</h2>
        <div style="overflow-x:auto"><table class="tbl" style="width:100%;border-collapse:collapse"><thead><tr style="text-align:left"><th>Compte</th><th>Scans</th><th>wineapi</th><th>Claude</th><th>Forfait wineapi</th><th>Total</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.slug)}</td><td class="num">${r.scans}</td><td class="num">${r.wineapi}</td><td class="num">${eur2(r.claude_eur)}</td><td class="num">${eur2(r.wineapi_eur)}</td><td class="num"><b>${eur2(r.total)}</b></td></tr>`).join("") || `<tr><td colspan="6" class="muted">Aucune consommation ce mois-ci.</td></tr>`}</tbody>
        <tfoot><tr><td><b>Total</b></td><td></td><td></td><td></td><td></td><td class="num"><b>${eur2(tot)}</b></td></tr></tfoot></table></div>
        <div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn" id="ccopier">Copier le récap</button><button class="btn" id="ccsv">Export CSV</button></div>
        <form id="cpar" class="row" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:16px;align-items:flex-end">
          <label class="f">Forfait wineapi mensuel (€)<input id="pforf" type="number" step="0.01" min="0" value="${D.forfait}"></label>
          <label class="f">Taux 1 $ en €<input id="ptaux" type="number" step="0.0001" min="0" value="${D.taux}"></label>
          <button class="btn primary">Enregistrer</button></form>
        <div class="note">Le forfait wineapi est réparti au prorata des recherches de chacun.</div></section>`;
    }
    box.innerHTML = html;
    $("#cmois").onchange = (e) => { S.ui.mois = e.target.value; rendre(); };
    if (!estAdmin()) return;
    $("#ccopier").onclick = async () => { try { await navigator.clipboard.writeText(recapTexte(rows, S.ui.mois)); toast("Récap copié."); } catch { toast("Copie impossible."); } };
    $("#ccsv").onclick = () => {
      const r2 = [["mois", "compte", "scans", "appels_wineapi", "claude_eur", "forfait_wineapi_eur", "total_eur"], ...rows.map((r) => [S.ui.mois, r.slug, r.scans, r.wineapi, r.claude_eur.toFixed(4), r.wineapi_eur.toFixed(2), r.total.toFixed(2)])];
      const csv = r2.map((r) => r.join(";")).join("\n");
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv" })); a.download = `consommation-cave-${S.ui.mois}.csv`; a.click();
    };
    $("#cpar").onsubmit = async (e) => {
      e.preventDefault();
      const f = Number($("#pforf").value) || 0, t = Number($("#ptaux").value) || 0.86;
      const { error } = await sb.from("parametres").upsert([{ cle: "wineapi_forfait_eur", valeur: f, updated_at: new Date().toISOString() }, { cle: "taux_usd_eur", valeur: t, updated_at: new Date().toISOString() }]);
      if (error) return toast("Erreur : " + error.message);
      D.forfait = f; D.taux = t; toast("Paramètres enregistrés."); rendre();
    };
  };
  rendre();
}
function bandeauConso() {
  if (!estAdmin() || new Date().getDate() > 7) return "";
  const prec = new Date(); prec.setDate(1); prec.setMonth(prec.getMonth() - 1);
  const k = moisCle(prec);
  try { if (localStorage.getItem("conso-vu") === k) return ""; } catch {}
  return `<div class="banner"><span>Récap de consommation de ${esc(moisLib(k))} prêt à refacturer.</span><a class="btn sm" href="#compte" data-act="conso-vu" data-k="${k}">Voir</a></div>`;
}

/* ---------------- Première connexion : cave de démonstration, tutoriel, création de la cave ---------------- */
async function entrerDemo() {
  try {
    const d = await (await fetch("demo.json?v=22")).json();
    S.vrai = S.d; S.d = d; S.demo = true; S.ui.cave = d.caves[0].id; S.ui.mode = "3d";
  } catch (e) { console.warn("démo indisponible", e); }
}
function quitterDemo() { if (!S.demo) return; S.demo = false; S.d = S.vrai || S.d; S.ui.cave = null; S.ui.couleur = ""; }
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
function accueilDemo() { if (!S.demo) return; lsGet("cave-tuto-vu") ? etapeCreation() : tutoriel(); }

const attendre = (sel, ms = 3000) => new Promise((ok) => { const t0 = performance.now(); (function f() { const el = document.querySelector(sel); if (el || performance.now() - t0 > ms) ok(el); else requestAnimationFrame(f); })(); });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const ETAPES = [
  { h: "dashboard", t: "Bienvenue dans Cave", x: "Voici une cave de démonstration : 25 vrais vins, rangés dans une vraie cave. Découvrez l'essentiel en 6 étapes, puis créez la vôtre." },
  { h: "dashboard", sel: "#qg", zone: (el) => el.closest("div[style*='relative']"), t: "Retrouvez n'importe quel vin", x: "Tapez un domaine, une appellation, un millésime… Les résultats s'affichent dès la première lettre.",
    prep: async (el) => { el.value = "Bourgogne"; el.dispatchEvent(new Event("input", { bubbles: true })); await pause(250); } },
  { h: "dashboard", sel: "#cesoir", t: "Que boire ce soir ?", x: "Cave croise la météo, ce que vous mangez et l'apogée de chaque bouteille pour vous proposer le bon vin, au bon moment." },
  { h: "vins", mode: "3d", sel: "#zone", t: "Votre cave en 3D", x: "Chaque casier, chaque bouteille à sa place. Faites pivoter la pièce du doigt, touchez une bouteille pour ouvrir sa fiche. Les filtres de couleur l'allument dans la cave." },
  { h: "dashboard", sel: "#horl", t: "À boire en priorité", x: "L'horloge d'apogée signale les bouteilles à ouvrir vite, avant qu'elles ne déclinent. Plus de grand vin oublié au fond d'un casier." },
  { h: () => "vin-" + ((S.d.vins.filter((v) => v.fournisseur && v.prix_achat && v.valeur_unitaire > v.prix_achat).sort((x, y) => y.valeur_unitaire / y.prix_achat - x.valeur_unitaire / x.prix_achat)[0] || S.d.vins[0]).id), sel: "#achat", t: "Prix, valeur et origine", x: "Pour chaque vin : où vous l'avez acheté (foire aux vins, caviste, domaine…), combien il vous a coûté et ce qu'il vaut aujourd'hui." },
];
let TUTO = null;
async function tutoriel(i = 0) {
  if ($("#modal").open) closeModal();
  if (!TUTO) {
    document.body.insertAdjacentHTML("beforeend", `<div class="tuto" id="tuto" role="dialog" aria-modal="true" aria-labelledby="tuto-t"><div class="tuto-hole" id="tuto-hole"></div><div class="tuto-card" id="tuto-card"></div></div>`);
    TUTO = { i: 0 }; addEventListener("resize", placerTuto); addEventListener("keydown", toucheTuto);
  }
  TUTO.i = i; const e = ETAPES[i];
  const h = typeof e.h === "function" ? e.h() : e.h; if (e.mode) S.ui.mode = e.mode;
  $("#tuto-card").innerHTML = `<div class="tuto-n">${i + 1} / ${ETAPES.length}</div><h2 id="tuto-t">${esc(e.t)}</h2><p>${esc(e.x)}</p>
    <div class="tuto-dots">${ETAPES.map((_, k) => `<i aria-current="${k === i}"></i>`).join("")}</div>
    <div class="tuto-foot"><button class="btn-link" id="tuto-skip" type="button">Passer le tutoriel</button><span class="row" style="gap:8px">${i ? `<button class="btn sm" id="tuto-prev" type="button">Précédent</button>` : ""}<button class="btn sm primary" id="tuto-next" type="button">${i === ETAPES.length - 1 ? "Créer ma cave" : "Suivant"}</button></span></div>`;
  $("#tuto-skip").onclick = finTuto; $("#tuto-next").onclick = () => (i === ETAPES.length - 1 ? finTuto() : tutoriel(i + 1)); if (i) $("#tuto-prev").onclick = () => tutoriel(i - 1);
  $("#tuto-next").focus({ preventScroll: true });
  TUTO.cible = null; $("#tuto").classList.add("nohole"); placerTuto();
  if (location.hash !== "#" + h) { go(h); await pause(120); } else if (e.mode && S.view === "vins") vVins();
  if (e.sel) {
    let el = await attendre(e.sel); if (!el || TUTO?.i !== i) return;
    if (e.prep) await e.prep(el);
    el = e.zone ? e.zone(el) || el : el;
    const r = el.getBoundingClientRect(); window.scrollTo({ top: Math.max(0, scrollY + r.top - 84), behavior: "instant" });
    TUTO.cible = el; $("#tuto").classList.remove("nohole"); placerTuto();
  }
}
function placerTuto() {
  if (!TUTO) return; const hole = $("#tuto-hole"); const el = TUTO.cible;
  if (!el) return; const r = el.getBoundingClientRect(), m = 8, vh = innerHeight;
  const top = Math.max(6, r.top - m), bas = Math.min(vh - 6, r.bottom + m);
  Object.assign(hole.style, { top: top + "px", left: Math.max(6, r.left - m) + "px", width: Math.min(innerWidth - 12, r.width + 2 * m) + "px", height: Math.max(40, bas - top) + "px" });
}
function toucheTuto(ev) { if (!TUTO) return; if (ev.key === "Escape") finTuto(); else if (ev.key === "ArrowRight") $("#tuto-next")?.click(); else if (ev.key === "ArrowLeft") $("#tuto-prev")?.click(); }
function finTuto() {
  lsSet("cave-tuto-vu", "1"); $("#tuto")?.remove(); TUTO = null; removeEventListener("resize", placerTuto); removeEventListener("keydown", toucheTuto);
  if (S.demo) { S.ui.couleur = ""; go("dashboard"); setTimeout(etapeCreation, 200); }
}

/* Étape 1 incontournable : créer sa cave, puis y mettre ses vins (à la main, Excel ou photos) */
const METHODES = {
  manuel: ["À la main", "Ajoutez vos bouteilles une à une. Tapez quelques lettres, Cave complète le reste (appellation, garde, prix).", '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'],
  excel: ["Depuis un fichier Excel", "Vous tenez déjà un inventaire ? Importez-le en une fois (.xlsx ou .csv) : domaine, millésime, quantité…", '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>'],
  photos: ["En photographiant les étiquettes", "Prenez l'étiquette en photo : Cave la lit et remplit la fiche du vin pour vous.", '<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/>'],
};
function etapeCreation() {
  if (TUTO) return finTuto();
  const m = modal(`<div class="creer"><div class="eyebrow">Étape 1 · la plus importante</div><h2>Créez votre cave</h2>
    <p class="muted" style="margin:0">Votre cave sera <b>modélisée en 3D</b>, casier par casier. Vous y retrouverez chacun de vos vins à sa place, et toutes les fonctions que vous venez de voir s'appliqueront à vos bouteilles.</p>
    <ol class="creer-et"><li><b>Nommez votre cave</b> et ajoutez quelques photos des murs : elles servent à la modéliser.</li><li><b>Décrivez vos casiers</b> (grilles, losanges, étagères, vrac).</li><li><b>Ajoutez vos vins</b>, de la façon qui vous convient :</li></ol>
    <div class="creer-choix">${Object.entries(METHODES).map(([k, [t, x, ic]]) => `<button type="button" class="creer-opt" data-meth="${k}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg><span><b>${t}</b><small>${x}</small></span></button>`).join("")}</div>
    ${S.demo ? `<button type="button" class="btn-link" id="encore" style="align-self:center">Explorer encore la démo</button>` : ""}</div>`, (dlg) => {
    dlg.oncancel = (e) => { if (dlg.querySelector(".creer-choix")) e.preventDefault(); };
    dlg.querySelectorAll("[data-meth]").forEach((b) => (b.onclick = () => choisirMethode(b.dataset.meth)));
    $("#encore") && ($("#encore").onclick = () => { closeModal(); toast("Le bouton « Créer ma cave » reste en haut de chaque page."); });
  });
  return m;
}
function choisirMethode(meth) {
  lsSet("cave-methode", meth); closeModal();
  quitterDemo(); S.apresCave = (caveId) => apresCreation(caveId, meth);
  // L'inscription a déjà créé une cave vide : on la complète au lieu d'en créer une deuxième
  const vide = S.d.caves.find((c) => !S.d.rangements.some((r) => r.cave_id === c.id));
  location.hash = "vins"; setTimeout(() => { formCave(vide || null);
    // Annulation : on revient à la démo au lieu de laisser un compte vide
    $("#modal").addEventListener("close", async () => { if (!S.apresCave) return; S.apresCave = null; await entrerDemo(); route(); toast("Création annulée. Le bouton « Créer ma cave » reste en haut de chaque page."); }, { once: true }); }, 80);
}
function apresCreation(caveId, meth = lsGet("cave-methode") || "manuel") {
  const [t] = METHODES[meth] || METHODES.manuel;
  modal(`<div class="creer"><div class="eyebrow">Cave créée ✓</div><h2>Et maintenant ?</h2>
    <ol class="creer-et"><li><b>Ajoutez vos casiers</b> : c'est ce qui construit votre cave en 3D. Vous pourrez les placer mur par mur.</li><li><b>Ajoutez vos vins</b> ${esc(t.toLowerCase())}. Les bouteilles non rangées vous attendront, il suffira de toucher une place libre pour les ranger.</li></ol>
    <div class="dlg-foot"><button type="button" class="btn" id="ap-rg">Ajouter un casier</button><button type="button" class="btn primary" id="ap-vins">Ajouter mes vins</button></div></div>`, () => {
    $("#ap-rg").onclick = () => { closeModal(); S.ui.mode = "casier"; go("vins"); setTimeout(() => formRangement(caveId), 120); };
    $("#ap-vins").onclick = () => { closeModal(); if (meth === "excel") return importExcel(); SCAN = { mode: meth === "photos" ? "etiquette" : "saisie", fichiers: [], res: null, base: {} }; go("scan"); };
  });
}

/* Import d'un inventaire Excel / CSV : une ligne par vin, colonnes reconnues par leur intitulé */
const COLS_IMPORT = {
  domaine: /domaine|ch[aâ]teau|producteur|propri/i, cuvee: /cuv[ée]e|nom du vin|^nom$|^vin$/i, appellation: /appellation|aoc|aop/i, region: /r[ée]gion/i, pays: /pays/i,
  couleur: /couleur|type/i, millesime: /mill[ée]sime|ann[ée]e|vintage/i, quantite: /quantit|qt[ée]|nombre|nb|bouteilles/i, prix_achat: /prix/i, fournisseur: /fournisseur|origine|achet|provenance|lieu d.achat/i, date_achat: /date/i,
};
function couleurDe(x) { const s = sansAccent(String(x || "")); return /rose/.test(s) ? "rose" : /blanc|white/.test(s) ? "blanc" : /champ|cremant|effer|mousseux|petillant|bulle/.test(s) ? "effervescent" : /liquo|moelleux|doux|sauternes/.test(s) ? "liquoreux" : /rouge|red/.test(s) ? "rouge" : "autre"; }
// Places libres d'une cave (cases de grille non occupées), mélangées
function libresCave(caveId) {
  const occ = new Set(S.d.bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id).map((b) => `${b.rangement_id}|${cleB(b)}`));
  const out = [];
  for (const r of S.d.rangements.filter((r) => r.cave_id === caveId && r.lignes && r.colonnes && !["caisse", "vrac"].includes(r.type)))
    for (let l = 1; l <= r.lignes; l++) for (let c = 1; c <= r.colonnes; c++) for (let d = 1; d <= profRg(r); d++) if (!occ.has(`${r.id}|${l}|${c}|${d}`)) out.push({ rangement_id: r.id, ligne: l, colonne: c, emplacement: d === 2 ? ARR : null });
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
async function rangerHasard(caveId) {
  const bs = S.d.bouteilles.filter((b) => b.statut === "en_cave" && !b.rangement_id), places = libresCave(caveId), cave = S.d.caves.find((c) => c.id === caveId);
  const n = Math.min(bs.length, places.length);
  if (!n) return toast("Aucune place libre dans cette cave.");
  const ok = await new Promise((fin) => modal(`<h2>Ranger au hasard ?</h2><p style="margin:0">${n} bouteille${n > 1 ? "s" : ""} non rangée${n > 1 ? "s" : ""} ${n > 1 ? "seront placées" : "sera placée"} dans les places libres de <b>${esc(cave?.nom ?? "la cave")}</b>. Vous pourrez les déplacer ensuite.</p>
    <div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="ok" type="button">Ranger</button></div>`, (dlg) => { dlg.addEventListener("close", () => fin(false), { once: true }); $("#ok").onclick = () => { fin(true); closeModal(); }; }));
  if (!ok) return;
  for (let i = 0; i < n; i++) { const p = places[i]; await q(sb.from(T("bouteilles")).update(p).eq("id", bs[i].id)); }
  await journal("deplacement", null, n, `Rangement au hasard · ${cave?.nom ?? ""}`);
  toast(n < bs.length ? `${n} bouteilles rangées. ${bs.length - n} restent non rangées : la cave est pleine.` : `${n} bouteilles rangées au hasard.`);
  S.ui.mode = "3d"; refresh();
}
function choixRangement() {
  const cs = S.d.caves.map((c) => [c, libresCave(c.id).length]).filter(([, n]) => n);
  if (!cs.length) return "";
  return `<fieldset class="xrg" id="xrg"><legend>Où mettre ces bouteilles ?</legend>
    <label><input type="radio" name="xrg" value="vide"> <span>Les laisser <b>non rangées</b> : je les placerai moi-même dans les casiers</span></label>
    <label><input type="radio" name="xrg" value="hasard"> <span>Les <b>ranger au hasard</b> dans les places libres de <select id="xcv">${cs.map(([c, n]) => `<option value="${c.id}" ${c.id === S.ui.cave ? "selected" : ""}>${esc(c.nom)} (${n} places libres)</option>`).join("")}</select></span></label></fieldset>`;
}

function importExcel() {
  let lignes = [], map = {};
  modal(`<h2>Importer un fichier Excel</h2><p class="muted" style="margin:0">Une ligne par vin. Colonnes reconnues : domaine, cuvée, appellation, région, pays, couleur, millésime, quantité, prix, origine (foire, caviste…), date d'achat. Seul le domaine est obligatoire.</p>
    <div class="row"><label class="btn primary"><input type="file" id="xin" accept=".xlsx,.xls,.csv,.ods" hidden>Choisir le fichier</label><button type="button" class="btn-link" id="xmod">Télécharger un modèle</button></div>
    <div id="xres"></div><div class="dlg-foot"><button class="btn" value="x" formnovalidate>Annuler</button><button class="btn primary" id="xok" type="button" disabled>Importer</button></div>`, () => {
    $("#xmod").onclick = () => {
      const csv = "Domaine;Cuvée;Appellation;Région;Couleur;Millésime;Quantité;Prix d'achat;Origine;Date d'achat\nDomaine Exemple;Les Vieilles Vignes;Saint-Joseph;Vallée du Rhône;Rouge;2020;6;18;Foire aux vins;2023-09-15\n";
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = "modele-import-cave.csv"; a.click();
    };
    $("#xin").onchange = async (ev) => {
      const f = ev.target.files[0]; if (!f) return; $("#xres").innerHTML = '<span class="spin"></span>';
      try {
        const X = await import("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/xlsx.mjs");
        const wb = X.read(await f.arrayBuffer(), { cellDates: true });
        const rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
        const heads = Object.keys(rows[0] || {}); map = {};
        Object.entries(COLS_IMPORT).forEach(([k, re]) => { const h = heads.find((x) => re.test(x) && !Object.values(map).includes(x)); if (h) map[k] = h; });
        if (!map.domaine) throw new Error("aucune colonne « Domaine » trouvée");
        lignes = rows.filter((r) => String(r[map.domaine]).trim());
        const nb = lignes.reduce((s, r) => s + (parseInt(r[map.quantite]) || 1), 0);
        $("#xres").innerHTML = `<div class="banner"><span><b>${lignes.length} vins · ${nb} bouteilles</b> détectés</span></div><div class="row" style="gap:6px">${Object.entries(map).map(([k, h]) => `<span class="chip">${esc(h)} → ${esc(k.replace("_", " "))}</span>`).join("")}</div>
          <div class="muted" style="font-size:12px">${lignes.slice(0, 4).map((r) => esc([r[map.domaine], r[map.cuvee], r[map.millesime]].filter(Boolean).join(" "))).join("<br>")}${lignes.length > 4 ? "<br>…" : ""}</div>${choixRangement()}`;
        $("#xok").disabled = !lignes.length;
      } catch (e) { $("#xres").innerHTML = `<div class="banner"><span>Lecture impossible : ${esc(e.message)}</span></div>`; }
    };
    $("#xok").onclick = async () => {
      const choix = $("#xrg") ? $("#xrg input[name=xrg]:checked")?.value : "vide";
      if (!choix) { $("#xrg").classList.add("a-choisir"); return toast("Choisissez : ranger au hasard, ou laisser non rangées."); }
      const places = choix === "hasard" ? libresCave($("#xcv").value) : [];
      const b = $("#xok"); b.disabled = true; b.innerHTML = '<span class="spin"></span>';
      try {
        const val = (r, k) => (map[k] ? String(r[map[k]] ?? "").trim() : "");
        const num = (x) => { const n = parseFloat(String(x).replace(",", ".").replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; };
        const dt = (r) => { const x = map.date_achat && r[map.date_achat]; if (!x) return null; const d = x instanceof Date ? x : new Date(String(x).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1")); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
        const rows = lignes.map((r) => ({ domaine: val(r, "domaine"), cuvee: val(r, "cuvee") || null, appellation: val(r, "appellation") || null, region: val(r, "region") || null, pays: val(r, "pays") || "France", couleur: couleurDe(val(r, "couleur")), millesime: num(val(r, "millesime")) ? Math.round(num(val(r, "millesime"))) : null, prix_achat: num(val(r, "prix_achat")), fournisseur: val(r, "fournisseur") || null, date_achat: dt(r), garde_source: null, cepages: [], accords: [], avis: [] }));
        let total = 0, ranges = 0;
        for (let i = 0; i < rows.length; i += 200) {
          const part = rows.slice(i, i + 200); const ins = await q(sb.from(T("vins")).insert(part).select("id"));
          const bt = []; ins.forEach((v, j) => { const n = Math.max(1, parseInt(val(lignes[i + j], "quantite")) || 1); total += n; for (let k = 0; k < n; k++) { const p = places.shift(); if (p) ranges++; bt.push({ vin_id: v.id, ...(p || {}) }); } });
          for (let k = 0; k < bt.length; k += 500) await q(sb.from(T("bouteilles")).insert(bt.slice(k, k + 500)));
        }
        await journal("entree", null, total, `Import Excel · ${rows.length} vins`);
        closeModal();
        toast(!ranges ? `${total} bouteilles importées. Rangez-les dans vos casiers pour les voir en 3D.` : ranges < total ? `${total} bouteilles importées : ${ranges} rangées au hasard, ${total - ranges} non rangées (cave pleine).` : `${total} bouteilles importées et rangées au hasard.`);
        if (ranges) S.ui.cave = $("#xcv")?.value || S.ui.cave;
        await charger(); S.ui.mode = ranges ? "3d" : "casier"; go("vins");
        revalImport(S.d.vins.filter((v) => !v.valeur_unitaire && !v.valeur_maj).map((v) => v.id));
      } catch (e) { b.disabled = false; b.textContent = "Importer"; toast("Import impossible : " + e.message); }
    };
  });
}

demarrer();
