// Disposition des casiers dans la pièce (sans dépendance 3D, partagée par le plan, l'éditeur de mur et la 3D).
export const PROF = 0.36;
/** Longueur utile d'un mur. Positions le long du mur mesurées depuis la gauche, vu de l'intérieur de la pièce. */
export const longueurMur = (plan, mur) => (mur === "N" || mur === "S" ? plan.largeur : plan.longueur);

/** Position {x, y} (m, coin bas-gauche, vu de face) de chaque casier sur son mur. */
export function positions(plan, rgs) {
  const M = plan.module || 0.5, pos = plan.pos || {}, res = {};
  const parMur = {};
  rgs.forEach((r) => (parMur[r.mur || "N"] ??= []).push(r));
  for (const [mur, liste] of Object.entries(parMur)) {
    const long = longueurMur(plan, mur);
    const sans = liste.filter((r) => !pos[r.id]);
    const ext = sans.length ? Math.max(...sans.map((r) => (r.plan_col ?? 0) * (r.largeur_m || M) + (r.largeur_m || M))) : 0;
    const debut = Math.max(0.05, (long - ext) / 2);
    for (const r of liste) {
      if (pos[r.id]) res[r.id] = { x: +pos[r.id].x, y: +pos[r.id].y };
      else res[r.id] = { x: debut + (r.plan_col ?? 0) * (r.largeur_m || M), y: (r.plan_niv ?? 0) * M };
    }
  }
  return res;
}

/** Disposition 3D : centre (x, y, z), rotation et taille de chaque casier. */
export function disposition(plan, rgs) {
  const W = plan.largeur, L = plan.longueur, M = plan.module || 0.5;
  const P = positions(plan, rgs);
  return rgs.map((r) => {
    const mur = r.mur || "N", w = r.largeur_m || M, h = r.hauteur_m || M;
    const le = P[r.id].x + w / 2, y = P[r.id].y + h / 2;
    let x, z, rot;
    // Repère : porte (S) en z = 0, fond (N) en z = L ; en entrant, le mur droit (E) est en x = 0.
    if (mur === "N") { x = W - le; z = L - PROF / 2; rot = Math.PI; }
    else if (mur === "S") { x = le; z = PROF / 2; rot = 0; }
    else if (mur === "E") { x = PROF / 2; z = L - le; rot = Math.PI / 2; }
    else { x = W - PROF / 2; z = le; rot = -Math.PI / 2; }
    return { r, x, y, z, rot, w, h, mur, le };
  });
}

/**
 * Géométrie de face d'un casier (repère centré, mètres, y vers le haut) : lattes et cloisons, places des bouteilles.
 * Même dessin que la 3D : grille à taquets, cases 5×2, croix, diagonale, treillis de losanges, vrac (coupé en deux s'il est large).
 */
export const EPAIS = 0.018;
export function geometrie(forme, w, h, nlF = 0, ncF = 0) {
  const iw = w - 2 * EPAIS, ih = h - 2 * EPAIS, BR = 0.039;
  const traits = [], slots = [], lattes = [];
  const latte = (s, c) => {
    lattes.push([s, c]); const pts = [];
    for (const x of [-iw / 2, iw / 2]) { const y = s * x + c; if (Math.abs(y) <= ih / 2 + 1e-6) pts.push([x, y]); }
    for (const y of [-ih / 2, ih / 2]) { const x = (y - c) / s; if (Math.abs(x) <= iw / 2 + 1e-6) pts.push([x, y]); }
    if (pts.length < 2) return; pts.sort((a, b) => a[0] - b[0]);
    const a = pts[0], b = pts[pts.length - 1]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.04) traits.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], e: 0.012 });
  };
  const libre = (x, y) => lattes.every(([s, c]) => Math.abs(s * x - y + c) / Math.hypot(s, 1) > BR + 0.004);
  const empiler = (x0, x1, y0, y1, test = () => true) => {
    for (let k = 0, y = y0 + BR; y <= y1 - BR + 1e-6; k++, y += 0.066) {
      const dec = k % 2 ? 0.038 : 0;
      for (let x = x0 + BR + dec; x <= x1 - BR + 1e-6; x += 0.076) if (test(x, y)) slots.push({ x, y });
    }
  };
  if (forme === "grille") {
    const nc = ncF || Math.max(3, Math.round(iw / 0.082)), nl = nlF || Math.max(3, Math.floor(ih / 0.072));
    for (let c = 1; c < nc; c++) { const x = -iw / 2 + (c * iw) / nc; traits.push({ x1: x, y1: -ih / 2, x2: x, y2: ih / 2, e: 0.012 }); }
    for (let c = 0; c <= nc; c++) for (let l = 1; l < nl; l++) { const x = -iw / 2 + (c * iw) / nc, y = ih / 2 - (l * ih) / nl; traits.push({ x1: x - 0.015, y1: y, x2: x + 0.015, y2: y, e: 0.012 }); }
    for (let l = 1; l <= nl; l++) for (let c = 1; c <= nc; c++) slots.push({ x: -iw / 2 + ((c - 0.5) * iw) / nc, y: ih / 2 - (l * ih) / nl + 0.04, l, c });
  } else if (forme === "cases") {
    const nc = 5, nl = ih >= 0.3 ? 2 : 1;
    for (let c = 1; c < nc; c++) { const x = -iw / 2 + (c * iw) / nc; traits.push({ x1: x, y1: -ih / 2, x2: x, y2: ih / 2, e: EPAIS }); }
    for (let l = 1; l < nl; l++) { const y = ih / 2 - (l * ih) / nl; traits.push({ x1: -iw / 2, y1: y, x2: iw / 2, y2: y, e: EPAIS }); }
    for (let l = 0; l < nl; l++) for (let c = 0; c < nc; c++) {
      const x0 = -iw / 2 + (c * iw) / nc + EPAIS / 2, x1 = -iw / 2 + ((c + 1) * iw) / nc - EPAIS / 2, y1 = ih / 2 - (l * ih) / nl - EPAIS / 2, y0 = ih / 2 - ((l + 1) * ih) / nl + EPAIS / 2;
      const n0 = slots.length; empiler(x0, x1, y0, y1); if (slots.length === n0) slots.push({ x: (x0 + x1) / 2, y: y0 + BR });
    }
  } else if (forme === "croix" || forme === "diagonale") {
    const k = ih / iw; latte(-k, 0); if (forme === "croix") latte(k, 0);
    empiler(-iw / 2, iw / 2, -ih / 2, ih / 2, libre);
  } else if (forme === "losange") {
    const pas = 0.17, lim = (iw + ih) / 2 + pas, d0 = -Math.ceil(lim / pas) * pas;
    for (let c = d0; c <= lim; c += pas) { latte(1, c); latte(-1, c); }
    for (let a = d0; a <= lim; a += pas) for (let b = d0; b <= lim; b += pas) {
      const u = a + pas / 2, v = b + pas / 2, x = (v - u) / 2, y = (u + v) / 2 - pas * 0.12;
      if (Math.abs(x) <= iw / 2 - 0.03 && Math.abs(y) <= ih / 2 - 0.03) slots.push({ x, y });
    }
    slots.sort((p, q) => p.y - q.y || Math.abs(p.x) - Math.abs(q.x));
  } else {
    const nb = iw >= 0.46 && forme !== "clayette" ? 2 : 1;
    if (nb === 2) traits.push({ x1: 0, y1: -ih / 2, x2: 0, y2: ih / 2, e: EPAIS });
    for (let i = 0; i < nb; i++) empiler(-iw / 2 + (i * iw) / nb + (i ? EPAIS / 2 : 0), -iw / 2 + ((i + 1) * iw) / nb - (i < nb - 1 ? EPAIS / 2 : 0), -ih / 2, ih / 2);
    slots.sort((p, q) => p.y - q.y || p.x - q.x);
  }
  if (!slots.length) slots.push({ x: 0, y: -ih / 2 + BR });
  return { iw, ih, traits, slots };
}
/** Place les bouteilles d'un casier dans ses emplacements (stable : dépend de leur ligne/colonne d'inventaire). */
export function placer(r, slots, bs) {
  // Les bouteilles « Arrière » (rangement sur 2 de profondeur) ont leur propre occupation, derrière celle de devant
  const prisAv = new Array(slots.length).fill(0), prisAr = new Array(slots.length).fill(0);
  return bs.map((b, i) => {
    const arriere = b.emplacement === "Arrière" && b.ligne, pris = arriere ? prisAr : prisAv;
    let k = b.ligne && b.colonne ? ((b.ligne - 1) * (r.colonnes || 6) + (b.colonne - 1)) % slots.length : i % slots.length;
    for (let t = 0; t < slots.length && pris[k]; t++) k = (k + 1) % slots.length;
    const tour = pris[k]++; return { b, k, s: slots[k], tour, arriere: !!arriere };
  });
}

// Urgence à boire : déclin atteint, fin d'apogée proche, à l'apogée, à garder, inconnu
export const URGENCE = { urgent: 0xe5372b, bientot: 0xf59a23, apogee: 0x3fb24f, garder: 0x3a6fd8, inconnu: 0x6b6f78 };
export function urgence(v, an = new Date().getFullYear()) {
  if (!v?.apogee_debut) return "inconnu";
  const fin = v.apogee_fin ?? v.apogee_debut;
  if (an > fin || (v.declin_debut && an >= v.declin_debut)) return "urgent";
  if (an >= v.apogee_debut && fin - an <= 1) return "bientot";
  if (an >= v.apogee_debut) return "apogee";
  return "garder";
}
