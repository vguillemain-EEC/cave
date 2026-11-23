// Vue 3D de la cave : pièce, casiers modulaires en pin, bouteilles à leur place.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { disposition, PROF, urgence, URGENCE } from "./dispo.js?v=27";

const CAPS = { rouge: 0x7b1e3a, blanc: 0xe8d9a8, rose: 0xe59aa6, effervescent: 0xd9b45a, liquoreux: 0xc98a2b, autre: 0x8a8f99 };
const VERRE = { rouge: 0x1d2a1a, blanc: 0x5d6b33, rose: 0xd8a3a0, effervescent: 0x22301c, liquoreux: 0x8a5a1c, autre: 0x2a2a2a };
const EP = 0.018; // épaisseur des panneaux (m)

function texture(url, rx, ry) {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function etiquette(txt) {
  const c = document.createElement("canvas"); c.width = 128; c.height = 64;
  const g = c.getContext("2d"); g.fillStyle = "#9be15d"; g.fillRect(0, 0, 128, 64);
  g.fillStyle = "#1f2a10"; g.font = "bold 34px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(txt, 64, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.035), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }));
}

// Pierre de taille dessinée à la volée (pas d'image à charger)
function pierre(rx, ry) {
  const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d");
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.fillStyle = "#3b332b"; g.fillRect(0, 0, 512, 512);
  for (let y = 0, row = 0; y < 512; row++) {
    const h = 54 + rnd() * 34; let x = row % 2 ? -rnd() * 60 : 0;
    while (x < 512) {
      const w = 80 + rnd() * 90, t = 112 + rnd() * 50, k = rnd() * 0.2;
      g.fillStyle = `rgb(${t + 18},${t + 6 - k * 40},${t - 22 - k * 60})`;
      g.beginPath(); g.roundRect(x + 3, y + 3, w - 6, h - 6, 9); g.fill();
      for (let n = 0; n < 40; n++) { g.fillStyle = `rgba(${rnd() > 0.5 ? "255,250,240" : "60,50,40"},${0.05 + rnd() * 0.08})`; g.fillRect(x + 3 + rnd() * (w - 10), y + 3 + rnd() * (h - 10), 2 + rnd() * 10, 2 + rnd() * 6); }
      x += w;
    }
    y += h;
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// Fonds de cave : couleur des murs, du décor autour et du pan d'accent
export const FONDS = {
  lin: { nom: "Lin", mur: 0xece9e3, ciel: 0xeeeae4, accent: 0x6e1a2c },
  bordeaux: { nom: "Bordeaux", mur: 0x6b1a2e, ciel: 0x2a0a12, accent: 0xc9a227 },
  nuit: { nom: "Bleu nuit", mur: 0x243556, ciel: 0x0e1426, accent: 0xd8b56a },
  sauge: { nom: "Vert sauge", mur: 0x9bb39a, ciel: 0xdde7da, accent: 0x6b3f22 },
  terracotta: { nom: "Terracotta", mur: 0xc4683f, ciel: 0xf1dccb, accent: 0x33241b },
  ardoise: { nom: "Ardoise", mur: 0x3c4149, ciel: 0x1e2126, accent: 0xc49a3a },
  champagne: { nom: "Champagne", mur: 0xe8d39c, ciel: 0xf7eed6, accent: 0x7b1e3a },
  lavande: { nom: "Lavande", mur: 0xb3a2d4, ciel: 0xece6f6, accent: 0x4a2a6e },
};

// Fonds illustrés (générés) : fresque sur le mur du fond, ou décor autour d'une cave électrique
export const FONDS_IMG = {
  "r-bordeaux": { nom: "Bordeaux", groupe: "Régions", re: /bordeaux|m[ée]doc|graves|saint-[ée]milion|pomerol|sauternes/i },
  "r-bourgogne": { nom: "Bourgogne", groupe: "Régions", re: /bourgogne|beaujolais|chablis|c[ôo]te.?d.?or|m[âa]connais/i },
  "r-champagne": { nom: "Champagne", groupe: "Régions", re: /champagne/i },
  "r-rhone": { nom: "Vallée du Rhône", groupe: "Régions", re: /rh[ôo]ne/i },
  "r-loire": { nom: "Loire", groupe: "Régions", re: /loire/i },
  "r-alsace": { nom: "Alsace", groupe: "Régions", re: /alsace/i },
  "r-provence": { nom: "Provence", groupe: "Régions", re: /provence/i },
  "r-languedoc": { nom: "Languedoc", groupe: "Régions", re: /languedoc|roussillon/i },
  "r-toscane": { nom: "Toscane", groupe: "Régions", re: /toscane|tuscany|pi[ée]mont|italie/i },
  "d-domaine": { nom: "Le domaine", groupe: "Domaine et chai" },
  "d-chai": { nom: "Chai à barriques", groupe: "Domaine et chai" },
  "d-vendanges": { nom: "Pressoir et vendanges", groupe: "Domaine et chai" },
};
// « Selon mes vins » : la région la plus représentée en bouteilles
export function fondAuto(vins, bouteilles) {
  const n = {}; const par = new Map(vins.map((v) => [v.id, v]));
  for (const b of bouteilles) { if (b.statut !== "en_cave") continue; const v = par.get(b.vin_id); if (!v) continue; const t = `${v.region || ""} ${v.appellation || ""}`;
    const k = Object.keys(FONDS_IMG).find((k) => FONDS_IMG[k].re?.test(t)); if (k) n[k] = (n[k] || 0) + 1; }
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || "d-domaine";
}
function fresque(url, w, h, onTeinte) {
  // texture « cover » : remplit w × h sans déformer l'image 16:9
  const t = new THREE.TextureLoader().load(url, (tx) => {
    const ia = tx.image.width / tx.image.height, a = w / h;
    if (a < ia) { tx.repeat.set(a / ia, 1); tx.offset.set((1 - a / ia) / 2, 0); } else { tx.repeat.set(1, ia / a); tx.offset.set(0, (1 - ia / a) / 2); }
    if (onTeinte) { const c = document.createElement("canvas"); c.width = c.height = 8; const g = c.getContext("2d"); g.drawImage(tx.image, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } onTeinte(new THREE.Color(r / 64 / 255, gg / 64 / 255, b / 64 / 255)); }
  });
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export { disposition };

export function monter(container, ctx) {
  const { cave, rangements, bouteilles, vins, onBottle, onModule, sombre } = ctx;
  const plan = cave.plan || { largeur: 3, longueur: 4, hauteur: 2.4, module: 0.5 };
  const W = plan.largeur, L = plan.longueur, H = plan.hauteur || 2.4;
  const style = plan.style || "piece", armoire = style === "armoire";
  const cleImg = plan.fond === "auto" ? fondAuto(vins, bouteilles) : FONDS_IMG[plan.fond] ? plan.fond : null;
  const fond = cleImg ? null : FONDS[plan.fond] || null;
  const imgFond = cleImg ? `img/fonds/${cleImg}.jpg` : null;
  const vinPar = new Map(vins.map((v) => [v.id, v]));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fond ? fond.ciel : armoire ? 0x2b2d33 : style === "pierre" ? 0x2a221c : sombre ? 0x15171d : 0xeeeae4);
  const cam = new THREE.PerspectiveCamera(50, 1, 0.02, 50);
  cam.position.set(W / 2, 1.6, -1.2);
  const ctl = new OrbitControls(cam, renderer.domElement);
  ctl.target.set(W / 2, 0.9, L / 2); ctl.enableDamping = true; ctl.dampingFactor = 0.12; ctl.maxDistance = 3.2; ctl.minDistance = 0.3;
  ctl.minPolarAngle = Math.PI * 0.28; ctl.maxPolarAngle = Math.PI * 0.6;
  if (armoire) { ctl.maxDistance = 2.6; ctl.minAzimuthAngle = Math.PI - 1.1; ctl.maxAzimuthAngle = Math.PI + 1.1; } ctl.zoomToCursor = true; ctl.rotateSpeed = 0.6; ctl.zoomSpeed = 0.8;

  // Lumières : ambiance chaude de cave
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a7a66, 0.9));
  const plafonnier = new THREE.PointLight(0xffe2b8, armoire ? 4 : 9, 9, 1.6); plafonnier.position.set(W / 2, H - 0.15, L / 2); plafonnier.castShadow = true; plafonnier.shadow.mapSize.set(1024, 1024); scene.add(plafonnier);
  const lampe = new THREE.SpotLight(0xffd9a0, 6, 6, Math.PI / 3, 0.6, 1.5); lampe.position.set(0.5, 1.9, L * 0.55); lampe.target.position.set(W / 2, 2.4, L / 2); scene.add(lampe, lampe.target);

  // Pièce (ou caisson de cave électrique)
  if (armoire) {
    if (imgFond) { const decor = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.6), new THREE.MeshBasicMaterial({ map: fresque(imgFond, 6.4, 3.6) })); decor.position.set(W / 2, 1.45, L + 1.3); decor.rotation.y = Math.PI; scene.add(decor); }
    const sol = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: texture("img/carrelage.jpg", 5, 5), color: 0x9a948c, roughness: 0.8 }));
    sol.rotation.x = -Math.PI / 2; sol.position.set(W / 2, -0.12, L / 2); sol.receiveShadow = true; scene.add(sol);
    const noir = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0.3 });
    const inter = new THREE.MeshStandardMaterial({ color: 0x22252c, roughness: 0.7, side: THREE.DoubleSide });
    const E2 = 0.04, boite = (w, h, d, x, y, z, m) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; scene.add(o); return o; };
    boite(W + 2 * E2, E2, L + E2, W / 2, -0.12 + E2 / 2 + 0.06, L / 2, noir); // socle
    boite(W + 2 * E2, E2, L + E2, W / 2, H + E2 / 2, L / 2, noir); // dessus
    boite(E2, H + 0.12, L + E2, -E2 / 2, H / 2 - 0.06, L / 2, noir); boite(E2, H + 0.12, L + E2, W + E2 / 2, H / 2 - 0.06, L / 2, noir);
    boite(W, H, 0.01, W / 2, H / 2, L + 0.005, inter);
    const verre = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.6 }));
    verre.position.set(W / 2, H / 2, -0.03); scene.add(verre);
    [[W, 0.05, W / 2, H - 0.025], [W, 0.05, W / 2, 0.025], [0.05, H, 0.025, H / 2], [0.05, H, W - 0.025, H / 2]].forEach(([w, h, x, y]) => boite(w, h, 0.03, x, y, -0.03, noir));
    const led = new THREE.PointLight(0xdfe9ff, 2.2, 2.5, 1.4); led.position.set(W / 2, H - 0.08, L * 0.35); scene.add(led);
    const bandeau = boite(W - 0.1, 0.012, 0.02, W / 2, H - 0.06, 0.04, new THREE.MeshBasicMaterial({ color: 0xe8f0ff })); bandeau.castShadow = false;
  } else {
  const pierreux = style === "pierre";
  const matSol = new THREE.MeshStandardMaterial({ map: texture("img/carrelage.jpg", W / 1.2, L / 1.2), color: pierreux ? 0xb59a80 : 0xffffff, roughness: 0.8 });
  const sol = new THREE.Mesh(new THREE.PlaneGeometry(W, L), matSol); sol.rotation.x = -Math.PI / 2; sol.position.set(W / 2, 0, L / 2); sol.receiveShadow = true; scene.add(sol);
  const matMur = pierreux ? new THREE.MeshStandardMaterial({ map: pierre(Math.max(W, L) / 1.1, H / 1.1), roughness: 1, side: THREE.BackSide })
    : new THREE.MeshStandardMaterial({ color: fond ? fond.mur : 0xece9e3, roughness: 0.95, side: THREE.BackSide });
  const cache = new THREE.MeshBasicMaterial({ visible: false });
  if (imgFond) {
    const mural = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: fresque(imgFond, W, H, pierreux ? null : (c) => matMur.color.copy(new THREE.Color(0xece9e3).lerp(c, 0.55))), roughness: 0.9 }));
    mural.rotation.y = Math.PI; mural.position.set(W / 2, H / 2, L - 0.003); mural.receiveShadow = true; scene.add(mural);
  }
  const piece = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), pierreux ? [matMur, matMur, cache, matMur, matMur, matMur] : matMur); piece.position.set(W / 2, H / 2, L / 2); piece.receiveShadow = true; scene.add(piece);
  if (pierreux) {
    // Voûte en berceau au-dessus des murs
    const voute = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, L, 32, 1, true, Math.PI / 2, Math.PI), new THREE.MeshStandardMaterial({ map: pierre(W * 1.5, L / 1.1), roughness: 1, side: THREE.BackSide }));
    voute.rotation.x = Math.PI / 2; voute.position.set(W / 2, H, L / 2); voute.receiveShadow = true; scene.add(voute);
    [0, L].forEach((z) => { const f = new THREE.Mesh(new THREE.CircleGeometry(W / 2, 32, 0, Math.PI), matMur.clone()); f.material.side = THREE.DoubleSide; f.position.set(W / 2, H, z); scene.add(f); });
  } else if (!imgFond) {
  // Pan de mur bordeaux (fond, côté mur droit) et porte
  const bordeaux = new THREE.Mesh(new THREE.PlaneGeometry(0.9, H), new THREE.MeshStandardMaterial({ color: fond ? fond.accent : 0x6e1a2c, roughness: 0.9 }));
  bordeaux.rotation.y = Math.PI; bordeaux.position.set(W * 0.28, H / 2, L - 0.004); scene.add(bordeaux);
  }
  if (plan.porte) {
    const p = plan.porte; const porte = new THREE.Mesh(new THREE.PlaneGeometry(p.largeur, 2.02), new THREE.MeshStandardMaterial({ color: pierreux ? 0x5a3a22 : 0xf4f2ee, roughness: 0.6 }));
    porte.position.set(W - p.debut - p.largeur / 2, 1.01, 0.004); scene.add(porte);
    const rideau = new THREE.Mesh(new THREE.PlaneGeometry(p.largeur * 0.55, 1.6), new THREE.MeshStandardMaterial({ color: 0x5c1424, roughness: 1, side: THREE.DoubleSide }));
    if (!pierreux) { rideau.position.set(W - p.debut - p.largeur * 0.28, 1.15, 0.01); scene.add(rideau); }
  }
  }

  // Casiers
  const pin = texture("img/pin.jpg", 1, 1);
  const matBois = new THREE.MeshStandardMaterial({ map: pin, color: 0xffffff, roughness: 0.75 });
  const matFond = new THREE.MeshStandardMaterial({ map: pin, color: 0xd9c2a0, roughness: 0.85 });
  const cliquables = [], boites = [];
  const modules = new Map();
  const panneau = (g, w, h, d, x, y, z, rz = 0, mat = matBois) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.rotation.z = rz; m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };

  // Bouteilles (instanciées)
  const lieux = []; // {pos, quat, vin, b}
  const disp = disposition(plan, rangements);
  const taquets = []; // [groupe, x, y, z] des taquets de grille
  for (const d of disp) {
    const { r, w, h } = d; const g = new THREE.Group(); g.position.set(d.x, d.y, d.z); g.rotation.y = d.rot;
    // Caisson : fond, côtés, dessus, dessous
    panneau(g, w, h, EP, 0, 0, -PROF / 2 + EP / 2, 0, matFond);
    panneau(g, EP, h, PROF, -w / 2 + EP / 2, 0, 0); panneau(g, EP, h, PROF, w / 2 - EP / 2, 0, 0);
    panneau(g, w, EP, PROF, 0, h / 2 - EP / 2, 0); panneau(g, w, EP, PROF, 0, -h / 2 + EP / 2, 0);
    const iw = w - 2 * EP, ih = h - 2 * EP;
    const forme = r.forme || (r.type === "losange" ? "losange" : ["vrac", "caisse"].includes(r.type) ? "vrac" : "grille");
    // Géométrie physique (d'après les photos), indépendante de la numérotation ligne/colonne de l'inventaire
    const slots = []; // positions locales des bouteilles, dans l'ordre de remplissage
    const BR = 0.039; // rayon d'une bouteille + jeu
    const dedans = (x, y, m = BR) => Math.abs(x) <= iw / 2 - m + 1e-6 && Math.abs(y) <= ih / 2 - m + 1e-6;
    const lattes = []; // droites y = s·x + c
    const latte = (s, c) => {
      lattes.push([s, c]);
      const pts = [];
      for (const x of [-iw / 2, iw / 2]) { const y = s * x + c; if (Math.abs(y) <= ih / 2 + 1e-6) pts.push([x, y]); }
      for (const y of [-ih / 2, ih / 2]) { const x = (y - c) / s; if (Math.abs(x) <= iw / 2 + 1e-6) pts.push([x, y]); }
      if (pts.length < 2) return;
      pts.sort((a, b) => a[0] - b[0]); const a = pts[0], b = pts[pts.length - 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.04) return;
      panneau(g, L, 0.012, PROF * 0.96, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, Math.atan2(b[1] - a[1], b[0] - a[0]));
    };
    const libre = (x, y) => lattes.every(([s, c]) => Math.abs(s * x - y + c) / Math.hypot(s, 1) > BR + 0.004);
    // Remplit une zone par rangées empilées depuis le bas (bouteilles couchées, en quinconce)
    const empiler = (x0, x1, y0, y1, test = () => true) => {
      for (let k = 0, y = y0 + BR; y <= y1 - BR + 1e-6; k++, y += 0.066) {
        const dec = k % 2 ? 0.038 : 0;
        for (let x = x0 + BR + dec; x <= x1 - BR + 1e-6; x += 0.076) if (test(x, y)) slots.push({ x, y });
      }
    };
    if (forme === "grille") {
      // Montants fins avec taquets : une bouteille par alvéole
      const nc = Math.max(3, Math.round(iw / 0.082)), nl = Math.max(3, Math.floor(ih / 0.072));
      for (let c = 1; c < nc; c++) {
        const x = -iw / 2 + (c * iw) / nc;
        panneau(g, 0.012, ih, 0.022, x, 0, PROF / 2 - 0.02); panneau(g, 0.012, ih, 0.022, x, 0, -PROF / 2 + 0.06);
      }
      for (let c = 0; c <= nc; c++) for (let l = 1; l <= nl; l++) {
        const x = -iw / 2 + (c * iw) / nc, y = ih / 2 - (l * ih) / nl;
        if (l < nl) { taquets.push([g, x, y, PROF / 2 - 0.02]); taquets.push([g, x, y, -PROF / 2 + 0.06]); }
      }
      for (let l = 1; l <= nl; l++) for (let c = 1; c <= nc; c++) slots.push({ x: -iw / 2 + ((c - 0.5) * iw) / nc, y: ih / 2 - (l * ih) / nl + 0.04 });
    } else if (forme === "cases") {
      // 5 cases sur 2 rangs, cloisons pleines
      const nc = 5, nl = ih >= 0.3 ? 2 : 1;
      for (let c = 1; c < nc; c++) panneau(g, EP, ih, PROF, -iw / 2 + (c * iw) / nc, 0, 0);
      for (let l = 1; l < nl; l++) panneau(g, iw, EP, PROF, 0, ih / 2 - (l * ih) / nl, 0);
      for (let l = 0; l < nl; l++) for (let c = 0; c < nc; c++) {
        const x0 = -iw / 2 + (c * iw) / nc + EP / 2, x1 = -iw / 2 + ((c + 1) * iw) / nc - EP / 2;
        const y1 = ih / 2 - (l * ih) / nl - EP / 2, y0 = ih / 2 - ((l + 1) * ih) / nl + EP / 2;
        const n0 = slots.length; empiler(x0, x1, y0, y1);
        if (slots.length === n0) slots.push({ x: (x0 + x1) / 2, y: y0 + BR });
      }
    } else if (forme === "croix" || forme === "diagonale") {
      const k = ih / iw;
      latte(-k, 0); // diagonale : du haut gauche au bas droit
      if (forme === "croix") latte(k, 0);
      empiler(-iw / 2, iw / 2, -ih / 2, ih / 2, libre);
    } else if (forme === "losange") {
      // Treillis de losanges à 45°
      const pas = 0.17, lim = (iw + ih) / 2 + pas;
      for (let c = -Math.ceil(lim / pas) * pas; c <= lim; c += pas) { latte(1, c); latte(-1, c); }
      for (let a = -Math.ceil(lim / pas) * pas; a <= lim; a += pas) for (let b = -Math.ceil(lim / pas) * pas; b <= lim; b += pas) {
        const u = a + pas / 2, v = b + pas / 2; const x = (v - u) / 2, y = (u + v) / 2 - pas * 0.12;
        if (dedans(x, y, 0.03)) slots.push({ x, y });
      }
      slots.sort((p, q) => p.y - q.y || Math.abs(p.x) - Math.abs(q.x));
    } else {
      // Vrac : caisson ouvert, coupé en deux s'il est large
      const nb = iw >= 0.46 && forme !== "clayette" ? 2 : 1;
      if (nb === 2) panneau(g, EP, ih, PROF, 0, 0, 0);
      for (let i = 0; i < nb; i++) empiler(-iw / 2 + (i * iw) / nb + (i ? EP / 2 : 0), -iw / 2 + ((i + 1) * iw) / nb - (i < nb - 1 ? EP / 2 : 0), -ih / 2, ih / 2);
      slots.sort((p, q) => p.y - q.y || p.x - q.x);
    }
    if (!slots.length) slots.push({ x: 0, y: -ih / 2 + BR });
    // Étiquette verte
    const tag = etiquette(r.nom.replace(/^Casier\s*/i, "")); tag.position.set(-w / 2 + 0.06, -h / 2 + EP + 0.02, PROF / 2 + 0.002); g.add(tag);
    // Zone cliquable invisible
    const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, PROF), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.module = r; g.add(hit); cliquables.push(hit); boites.push(hit);
    scene.add(g); g.updateMatrixWorld(true);
    modules.set(r.id, { g, d });
    // Place les bouteilles
    const bs = bouteilles.filter((b) => b.statut === "en_cave" && b.rangement_id === r.id);
    const prisAv = new Array(slots.length).fill(0), prisAr = new Array(slots.length).fill(0);
    bs.forEach((b, i) => {
      const arriere = b.emplacement === "Arrière" && b.ligne, pris = arriere ? prisAr : prisAv;
      let k = b.ligne && b.colonne ? ((b.ligne - 1) * (r.colonnes || 6) + (b.colonne - 1)) % slots.length : i % slots.length;
      for (let t = 0; t < slots.length && pris[k]; t++) k = (k + 1) % slots.length;
      const s = slots[k], tour = pris[k]++;
      // Bouteille de derrière : même place, reculée dans le casier (on voit son culot derrière celle de devant)
      const local = new THREE.Vector3(s.x + (tour ? ((tour % 2) ? 0.018 : -0.018) : 0), s.y + (tour ? 0.01 : 0), arriere ? -0.3 : 0);
      lieux.push({ pos: g.localToWorld(local), rot: d.rot, vin: vinPar.get(b.vin_id), b });
    });
  }

  if (taquets.length) {
    const it = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.012, 0.022), matBois, taquets.length);
    const mt = new THREE.Matrix4(), v = new THREE.Vector3();
    taquets.forEach(([gr, x, y, z], i) => { gr.localToWorld(v.set(x, y, z)); mt.makeRotationY(gr.rotation.y); mt.setPosition(v); it.setMatrixAt(i, mt); });
    it.castShadow = true; it.receiveShadow = true; scene.add(it);
  }

  const corps = new THREE.CylinderGeometry(0.037, 0.037, 0.2, 18); corps.rotateX(Math.PI / 2);
  const col = new THREE.CylinderGeometry(0.014, 0.03, 0.08, 14); col.rotateX(Math.PI / 2); col.translate(0, 0, 0.14);
  const caps = new THREE.CylinderGeometry(0.0155, 0.0155, 0.045, 14); caps.rotateX(Math.PI / 2); caps.translate(0, 0, 0.19);
  const n = lieux.length;
  const iCorps = new THREE.InstancedMesh(corps, new THREE.MeshPhysicalMaterial({ roughness: 0.15, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.1 }), n);
  const iCol = new THREE.InstancedMesh(col, new THREE.MeshPhysicalMaterial({ roughness: 0.15, metalness: 0.1, clearcoat: 1 }), n);
  const iCaps = new THREE.InstancedMesh(caps, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4 }), n);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), un = new THREE.Vector3(1, 1, 1), c3 = new THREE.Color();
  lieux.forEach((p, i) => {
    e.set(0, p.rot, 0); q.setFromEuler(e); // goulot et capsule vers l'avant du casier
    const pos = p.pos.clone().add(new THREE.Vector3(0, 0, -0.07).applyQuaternion(q));
    m4.compose(pos, q, un); p.base = pos.clone(); p.q = q.clone();
    [iCorps, iCol, iCaps].forEach((im) => im.setMatrixAt(i, m4));
  });
  // Couleurs : par type de vin, ou « urgence à boire » (carte de chaleur)
  let mode = "vin", filtreCoul = null;
  const teinte = (i) => {
    const p = lieux[i], k = p.vin?.couleur || "autre";
    if (filtreCoul && k !== filtreCoul) return [0x161616, 0x2a2a2a];
    if (mode !== "urgence") return [VERRE[k] ?? VERRE.autre, CAPS[k] ?? CAPS.autre];
    const u = URGENCE[urgence(p.vin)]; return [u, u];
  };
  function peindre(i, f = 1) { const [v, c] = teinte(i); iCorps.setColorAt(i, c3.setHex(v).multiplyScalar(f)); iCol.setColorAt(i, c3); iCaps.setColorAt(i, c3.setHex(c).multiplyScalar(f)); }
  function toutPeindre() { lieux.forEach((_, i) => peindre(i)); [iCorps, iCol, iCaps].forEach((im) => im.instanceColor && (im.instanceColor.needsUpdate = true)); }
  toutPeindre();
  [iCorps, iCol, iCaps].forEach((im) => { im.castShadow = true; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; scene.add(im); });
  cliquables.unshift(iCaps, iCorps, iCol);

  // Bouteille qui sort du casier : glisse vers l'avant, se relève, et la caméra vient la voir
  const AV = new THREE.Vector3(0, 0, 1), axeX = new THREE.Vector3(1, 0, 0);
  const anims = new Map(); // instance -> {de, a, s}
  let sortie = null;
  function poser(i, k) {
    const p = lieux[i]; const avant = AV.clone().applyQuaternion(p.q);
    const pos = p.base.clone().add(avant.multiplyScalar(0.34 * k)).add(new THREE.Vector3(0, 0.06 * k, 0));
    const qq = p.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(axeX, -0.35 * k));
    m4.compose(pos, qq, un); [iCorps, iCol, iCaps].forEach((im) => { im.setMatrixAt(i, m4); im.instanceMatrix.needsUpdate = true; });
  }
  const etat = (i) => anims.get(i)?.k ?? 0;
  function animer(i, vers) { anims.set(i, { de: etat(i), a: vers, s: performance.now(), k: etat(i) }); }
  function sortir(i, d = 0.42) {
    if (sortie != null && sortie !== i) animer(sortie, 0);
    sortie = i; animer(i, 1); objectif(50);
    const p = lieux[i], avant = AV.clone().applyQuaternion(p.q);
    const bout = p.base.clone().add(avant.clone().multiplyScalar(0.34)).add(new THREE.Vector3(0, 0.06, 0));
    const cote = new THREE.Vector3(-avant.z, 0, avant.x);
    const vise = bout.clone().add(new THREE.Vector3(0, -0.09, 0)).add(cote.clone().multiplyScalar(0.05));
    voler(vise.clone().add(avant.clone().multiplyScalar(d)).add(cote.multiplyScalar(0.43 * d)).add(new THREE.Vector3(0, 0.28 * d, 0)), vise, 650);
  }
  // Recherche : met en surbrillance les bouteilles d'un vin, assombrit les autres, sort la bouteille choisie
  const anneaux = new THREE.Group(); scene.add(anneaux);
  const geoAnneau = new THREE.TorusGeometry(0.03, 0.0045, 10, 28), matAnneau = new THREE.MeshBasicMaterial({ color: 0xffc83d, transparent: true, opacity: 0.95 });
  function surligner(ids, choisi) {
    const set = new Set(ids); anneaux.clear(); let n = 0, iChoisi = -1, premier = -1;
    lieux.forEach((p, i) => {
      if (set.has(p.b.id)) {
        peindre(i);
        n++; if (p.b.id === choisi) iChoisi = i; else if (premier < 0) premier = i;
        const a = new THREE.Mesh(geoAnneau, matAnneau); a.position.copy(p.base).add(AV.clone().applyQuaternion(p.q).multiplyScalar(0.215)); a.quaternion.copy(p.q); anneaux.add(a);
        iCaps.setColorAt(i, c3.setHex(0xffc83d));
      } else peindre(i, 0.25);
    });
    [iCorps, iCol, iCaps].forEach((im) => im.instanceColor && (im.instanceColor.needsUpdate = true));
    if (iChoisi < 0) iChoisi = premier;
    if (iChoisi >= 0) sortir(iChoisi, 1.1);
    return n;
  }
  function rentrer() { if (sortie != null) { animer(sortie, 0); sortie = null; } }

  // Animation de caméra
  let vol = null;
  function voler(pos, cible, dur = 700) { vol = { p0: cam.position.clone(), t0: ctl.target.clone(), p1: libre(pos.clone()), t1: cible, d: dur, s: performance.now() }; }

  // Espace où la caméra a le droit d'être : la pièce, moins le volume des casiers (avec une marge)
  const MARGE = 0.12;
  const obstacles = disp.map((d) => {
    const ex = d.mur === "E" || d.mur === "O" ? PROF / 2 : d.w / 2, ez = d.mur === "E" || d.mur === "O" ? d.w / 2 : PROF / 2;
    return { x0: d.x - ex - MARGE, x1: d.x + ex + MARGE, z0: d.z - ez - MARGE, z1: d.z + ez + MARGE, y1: d.y + d.h / 2 + MARGE };
  });
  function libre(p) {
    if (armoire) { p.y = Math.max(0.05, p.y); if (p.z > -0.12 && p.x > -0.1 && p.x < W + 0.1) p.z = Math.min(p.z, -0.12); return p; }
    p.x = Math.min(W - MARGE, Math.max(MARGE, p.x)); p.z = Math.min(L - MARGE, Math.max(MARGE, p.z)); p.y = Math.min(H - 0.1, Math.max(0.3, p.y));
    for (let n = 0; n < 3; n++) {
      let bouge = false;
      for (const o of obstacles) {
        if (p.x <= o.x0 || p.x >= o.x1 || p.z <= o.z0 || p.z >= o.z1 || p.y >= o.y1) continue;
        // sort par le côté le plus proche (au-dessus pour les casiers bas)
        const opts = [[o.x0 - p.x, 0], [o.x1 - p.x, 0], [0, o.z0 - p.z], [0, o.z1 - p.z]].filter(([dx, dz]) => { const x = p.x + dx, z = p.z + dz; return x >= MARGE - 1e-6 && x <= W - MARGE + 1e-6 && z >= MARGE - 1e-6 && z <= L - MARGE + 1e-6; });
        const haut = o.y1 + 0.001 - p.y;
        const best = opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))[0];
        if (o.y1 < 1.3 && (!best || haut < Math.hypot(...best))) p.y += haut; else if (best) { p.x += best[0]; p.z += best[1]; }
        bouge = true;
      }
      if (!bouge) break;
    }
    return p;
  }
  function focus(rid) {
    const m = modules.get(rid); if (!m) return; objectif(50);
    const c = new THREE.Vector3(); m.g.getWorldPosition(c);
    const face = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.d.rot);
    const devant = c.clone().add(face.clone().multiplyScalar(PROF / 2));
    voler(devant.clone().add(face.multiplyScalar(Math.max(0.75, Math.max(m.d.w, m.d.h) * 1.6))).add(new THREE.Vector3(0, 0.12, 0)), devant);
  }
  function objectif(f) { cam.fov = f; cam.updateProjectionMatrix(); }
  function vueGenerale() { objectif(50); if (armoire) return voler(new THREE.Vector3(W / 2 + 0.25, H * 0.62, -1.15 - H * 0.35), new THREE.Vector3(W / 2, H * 0.48, L / 2)); voler(new THREE.Vector3(W / 2, 1.75, 0.25), new THREE.Vector3(W / 2, 0.85, L * 0.62)); }

  // Clics
  const ray = new THREE.Raycaster(), souris = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => (down = [ev.clientX, ev.clientY]));
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!down || Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 6) return;
    const rc = renderer.domElement.getBoundingClientRect();
    souris.set(((ev.clientX - rc.left) / rc.width) * 2 - 1, -((ev.clientY - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(souris, cam);
    const tous = ray.intersectObjects(cliquables, false); const hit = tous.find((h) => h.instanceId != null) || tous[0];
    if (!hit) return;
    if (hit.instanceId != null && lieux[hit.instanceId]) {
      const p = lieux[hit.instanceId]; sortir(hit.instanceId);
      onBottle && onBottle(p.b, p.vin, ev);
    } else if (hit.object.userData.module) { rentrer(); focus(hit.object.userData.module.id); onModule && onModule(hit.object.userData.module); }
  });

  // Rendu
  let stop = false;
  const taille = () => { const w = container.clientWidth, h = container.clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  const ro = new ResizeObserver(taille); ro.observe(container); taille();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  (function boucle() {
    if (stop) return;
    if (vol) {
      const t = Math.min(1, (performance.now() - vol.s) / vol.d), k = ease(t);
      cam.position.lerpVectors(vol.p0, vol.p1, k); ctl.target.lerpVectors(vol.t0, vol.t1, k); if (t >= 1) vol = null;
    }
    if (anneaux.children.length) { const s = 1 + 0.18 * Math.sin(performance.now() / 220); anneaux.children.forEach((a) => a.scale.setScalar(s)); }
    for (const [i, a] of anims) {
      const t = Math.min(1, (performance.now() - a.s) / 450); a.k = a.de + (a.a - a.de) * ease(t); poser(i, a.k);
      if (t >= 1 && a.a === 0) anims.delete(i);
    }
    ctl.update();
    // la caméra reste dans l'allée : jamais dans un mur ni dans un casier ; si elle bute, le pivot suit
    if (!vol) {
      const avant = cam.position.clone(), apres = libre(cam.position.clone());
      if (apres.distanceToSquared(avant) > 1e-8) { cam.position.copy(apres); ctl.target.add(apres.sub(avant)); }
      // rien ne doit cacher le point visé : si un casier s'interpose, la caméra avance devant lui
      const dir = cam.position.clone().sub(ctl.target), len = dir.length(); dir.normalize();
      ray.set(ctl.target.clone().addScaledVector(dir, 0.06), dir); ray.far = Math.max(0, len - 0.06);
      const bloque = ray.intersectObjects(boites, false)[0];
      if (bloque && bloque.distance > 0.1 && !armoire) cam.position.copy(ctl.target).addScaledVector(dir, 0.06 + bloque.distance - 0.08);
      ray.far = Infinity;
      if (!armoire) ctl.target.x = Math.min(W, Math.max(0, ctl.target.x)); ctl.target.z = Math.min(L, Math.max(0, ctl.target.z)); ctl.target.y = Math.min(H - 0.2, Math.max(0.1, ctl.target.y));
    }
    renderer.render(scene, cam); requestAnimationFrame(boucle);
  })();
  vueGenerale();

  let derniere = vueGenerale;
  const murs = (m) => { derniere = () => murs(m); rentrer(); const c = new THREE.Vector3(W / 2, 1, L / 2); const v = { N: [W / 2, 1.3, 0.3], S: [W / 2, 1.3, L - PROF - 0.15], E: [W - PROF - 0.14, 1.25, L / 2], O: [PROF + 0.14, 1.25, L / 2] }[m]; objectif(66); if (v) voler(new THREE.Vector3(...v), { N: new THREE.Vector3(W / 2, 0.9, L - PROF), S: new THREE.Vector3(W / 2, 0.9, PROF), E: new THREE.Vector3(PROF, 0.95, L / 2), O: new THREE.Vector3(W - PROF, 0.95, L / 2) }[m] || c); };
  return {
    focus, rentrer, murs, surligner,
    couleurs: (m) => { mode = m; anneaux.clear(); toutPeindre(); },
    filtre: (c) => { filtreCoul = c; anneaux.clear(); toutPeindre(); return lieux.filter((p) => (p.vin?.couleur || "autre") === c).length; },
    vueGenerale: () => { derniere = vueGenerale; rentrer(); vueGenerale(); },
    retour: () => { rentrer(); derniere(); },
    zoom: (f) => { const dir = cam.position.clone().sub(ctl.target); voler(ctl.target.clone().add(dir.multiplyScalar(f)), ctl.target.clone(), 300); },
    dispose: () => { stop = true; ro.disconnect(); renderer.dispose(); renderer.domElement.remove(); },
  };
}
