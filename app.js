const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FREE_MEDS = 6;
const FREE_PEOPLE = 1;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'medpress_pro';
const PRO_IDS = [PRO_SKU];
let STORE_URL = 'https://apps.microsoft.com/detail/9N6RX8GF53K7';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('medpress-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}
function setPro(v) {
  isPro = v;
  try { localStorage.setItem('medpress-pro', v ? '1' : '0'); } catch (_) {}
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  document.body.classList.toggle('unlocked', unlocked());
  if (typeof renderAll === 'function') renderAll();
}
async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}
function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }
async function openPro(reason) {
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get MedPress on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}
async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) { proMessage('Thank you! Pro is unlocked. ★'); setTimeout(() => $('proDialog').close(), 1500); }
}
function needsPro(reason) {
  if (unlocked()) return false;
  openPro(reason);
  return true;
}


// ---------- options ----------
const PAPERS = { letter: { name: 'US Letter', w: 215.9, h: 279.4 }, a4: { name: 'A4', w: 210, h: 297 } };
const SLOTS = [{ k: 'm', name: 'Morning', short: 'Morning', col: '#f59e0b' }, { k: 'n', name: 'Midday', short: 'Midday', col: '#10b981' }, { k: 'e', name: 'Evening', short: 'Evening', col: '#3b82f6' }, { k: 'b', name: 'Bedtime', short: 'Bedtime', col: '#6366f1' }, { k: 'p', name: 'Only when needed', short: 'When needed', col: '#9ca3af' }];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FONT = '"Segoe UI", Arial, sans-serif';
const uid = () => Math.random().toString(36).slice(2, 10);
const blankPerson = () => ({ id: uid(), name: '', dob: '', allergies: '', doctor: '', doctorPhone: '', pharmacy: '', pharmacyPhone: '', emergency: '', emergencyPhone: '', meds: [] });

// ---------- state ----------
let st = { mode: 'week', paper: 'letter', large: true, weeks: 1, start: '', cur: '', people: [] };
try { Object.assign(st, JSON.parse(localStorage.getItem('medpress') || '{}')); } catch (_) {}
if (!st.people.length) { const p = blankPerson(); st.people.push(p); }
if (!st.people.some((p) => p.id === st.cur)) st.cur = st.people[0].id;
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem('medpress', JSON.stringify(st)); } catch (_) { toast('Could not save'); } }, 250); }
const person = () => st.people.find((p) => p.id === st.cur) || st.people[0];
function monday(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; x.setDate(x.getDate() - wd); return x; }
function startDate() { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(st.start || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : monday(new Date()); }
const fmtDay = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
const fmtLong = (d) => { try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }); } catch (_) { return d.toDateString(); } };
const timesText = (m, sep) => SLOTS.filter((s) => m.times && m.times[s.k]).map((s) => s.short).join(sep || ', ');

// ---------- text ----------
let mctx = null;
function textW(s, fs, weight) {
  if (typeof document !== 'undefined') { try { if (!mctx) mctx = document.createElement('canvas').getContext('2d'); mctx.font = `${weight || 400} 100px ${FONT}`; return mctx.measureText(s).width * fs / 100; } catch (_) {} }
  return String(s).length * fs * (weight >= 600 ? 0.57 : 0.52);
}
const fit = (s, fs, maxW, wt) => { const w = textW(s, fs, wt); return w > maxW ? fs * maxW / w : fs; };
function wrap(s, fs, maxW, wt) { const out = []; let line = ''; for (const w of String(s || '').split(/\s+/).filter(Boolean)) { const t = line ? line + ' ' + w : w; if (line && textW(t, fs, wt) > maxW) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }
const f2 = (n) => (+n).toFixed(2);
const T = (t, x, y, fs, extra, anchor) => (t === '' || t == null) ? '' : `<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(fs)}"${anchor ? ` text-anchor="${anchor}"` : ''}${extra || ''}>${esc(t)}</text>`;
const svgPage = (w, h, s) => ({ w, h, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm" font-family='${FONT}' fill="#111"><rect width="${w}" height="${h}" fill="#fff"/>${s}</svg>` });
const DISCLAIMER = 'Always follow the instructions from your doctor or pharmacist. Ask them if anything is unclear.';

// ---------- weekly tick chart (landscape) ----------
function weekPages(screen) {
  const P = PAPERS[st.paper] || PAPERS.letter, W = P.h, H = P.w, p = person(), L = st.large ? 1.25 : 1;
  const m = 10, nameW = 92, rowH = 9.5 * L, top = 31, foot = 16, colW = (W - 2 * m - nameW) / 7;
  const rows = []; // build rows: section headers and medicine rows
  SLOTS.forEach((s) => { const meds = p.meds.filter((x) => x.times && x.times[s.k]); if (meds.length) { rows.push({ head: s }); meds.forEach((x) => rows.push({ med: x, slot: s })); } });
  if (!rows.length) rows.push({ empty: true });
  const pages = [], perPage = Math.floor((H - top - foot - 8) / rowH), nWeeks = Math.max(1, Math.min(4, st.weeks | 0 || 1));
  for (let wk = 0; wk < nWeeks; wk++) {
    const d0 = startDate(); d0.setDate(d0.getDate() + 7 * wk);
    let i = 0;
    do {
      const chunk = rows.slice(i, i + perPage); i += perPage;
      let s = '';
      s += T(`Medicine chart${p.name ? ' – ' + p.name : ''}`, m, 15, fit(`Medicine chart – ${p.name}`, 8 * L, W * 0.62, 700), ' font-weight="700"');
      const d6 = new Date(d0); d6.setDate(d6.getDate() + 6);
      s += T(`Week of ${fmtLong(d0)}`, W - m, 15, 4.6 * L, ' fill="#333"', 'end');
      s += T('Tick each box when the medicine has been taken.', m, 22, 3.6 * L, ' fill="#555"');
      // day headers
      for (let c = 0; c < 7; c++) { const d = new Date(d0); d.setDate(d.getDate() + c); const x = m + nameW + c * colW; s += `<rect x="${f2(x)}" y="${f2(top - 7)}" width="${f2(colW)}" height="7" fill="${c >= 5 ? '#e5e7eb' : '#f3f4f6'}" stroke="#9ca3af" stroke-width=".25"/>` + T(`${DAYS[c]} ${fmtDay(d)}`, x + colW / 2, top - 2, fit(`${DAYS[c]} ${fmtDay(d)}`, 3.8 * L, colW - 2, 600), ' font-weight="600"', 'middle'); }
      let y = top;
      for (const r of chunk) {
        if (r.empty) { s += T(screen ? 'Add your medicines on the left to fill in the chart.' : '', m + 2, y + rowH * 0.7, 4 * L, ' fill="#9ca3af"'); y += rowH; continue; }
        if (r.head) { s += `<rect x="${m}" y="${f2(y)}" width="${f2(W - 2 * m)}" height="${f2(rowH * 0.75)}" fill="${r.head.col}" opacity=".18"/><rect x="${m}" y="${f2(y)}" width="2" height="${f2(rowH * 0.75)}" fill="${r.head.col}"/>` + T(r.head.name.toUpperCase(), m + 4, y + rowH * 0.53, 3.8 * L, ` font-weight="700" fill="#111" letter-spacing=".3"`); y += rowH * 0.75; continue; }
        const md = r.med, line1 = [md.name, md.dose].filter(Boolean).join('  '), line2 = [md.notes, md.look].filter(Boolean).join(' · ');
        s += `<rect x="${m}" y="${f2(y)}" width="${f2(W - 2 * m)}" height="${f2(rowH)}" fill="none" stroke="#9ca3af" stroke-width=".25"/>`;
        if (line2) { s += T(line1, m + 2, y + rowH * 0.45, fit(line1, 4.2 * L, nameW - 4, 600), ' font-weight="600"') + T(line2, m + 2, y + rowH * 0.85, fit(line2, 3 * L, nameW - 4), ' fill="#444"'); }
        else s += T(line1, m + 2, y + rowH * 0.64, fit(line1, 4.4 * L, nameW - 4, 600), ' font-weight="600"');
        for (let c = 0; c < 7; c++) { const x = m + nameW + c * colW, b = Math.min(rowH * 0.6, 7); s += `<line x1="${f2(x)}" y1="${f2(y)}" x2="${f2(x)}" y2="${f2(y + rowH)}" stroke="#9ca3af" stroke-width=".25"/>`; if (r.slot.k === 'p') s += `<line x1="${f2(x + 2)}" y1="${f2(y + rowH - 2)}" x2="${f2(x + colW - 2)}" y2="${f2(y + rowH - 2)}" stroke="#bbb" stroke-width=".25"/>`; else s += `<rect x="${f2(x + colW / 2 - b / 2)}" y="${f2(y + rowH / 2 - b / 2)}" width="${f2(b)}" height="${f2(b)}" rx="1" fill="#fff" stroke="#111" stroke-width=".35"/>`; }
        y += rowH;
      }
      const fy = H - foot + 4;
      const info = [p.allergies ? `Allergies: ${p.allergies}` : '', p.emergency ? `In an emergency call ${p.emergency}${p.emergencyPhone ? ' ' + p.emergencyPhone : ''}` : ''].filter(Boolean).join('   •   ');
      s += T(info, m, fy, fit(info, 3.8, W - 2 * m, 600), ' font-weight="600" fill="#b91c1c"');
      s += T(DISCLAIMER, m, fy + 6, 2.8, ' fill="#666"');
      pages.push(svgPage(W, H, s));
    } while (i < rows.length);
  }
  return pages;
}

// ---------- medicine list (portrait) ----------
function listPages(screen) {
  const P = PAPERS[st.paper] || PAPERS.letter, W = P.w, H = P.h, p = person(), L = st.large ? 1.2 : 1, m = 12;
  const cols = [{ t: 'Medicine', w: 0.27 }, { t: 'How much', w: 0.18 }, { t: 'When', w: 0.18 }, { t: 'What it is for', w: 0.18 }, { t: 'Notes', w: 0.19 }];
  const tw = W - 2 * m, fs = 3.9 * L, lh = fs * 1.3, pages = [];
  let s = '', y = 0;
  const header = (first) => {
    s = T(first ? 'My medicines' : 'My medicines (continued)', m, 20, 9 * L, ' font-weight="700"');
    const who = [p.name, p.dob ? `born ${p.dob}` : ''].filter(Boolean).join(', ');
    s += T(who || (screen ? 'Your name' : ''), m, 29, 5 * L, who ? '' : ' fill="#9ca3af"');
    s += T(`Updated ${fmtLong(new Date())}`, W - m, 20, 3.4, ' fill="#555"', 'end');
    y = 35;
    if (first) { const al = `Allergies: ${p.allergies || 'none known'}`; s += `<rect x="${m}" y="${y}" width="${f2(tw)}" height="${f2(9 * L)}" rx="1.5" fill="#fee2e2" stroke="#b91c1c" stroke-width=".4"/>` + T(al, m + 3, y + 6.2 * L, fit(al, 4.6 * L, tw - 6, 700), ' font-weight="700" fill="#991b1b"'); y += 9 * L + 5; }
    let x = m; s += `<rect x="${m}" y="${f2(y)}" width="${f2(tw)}" height="${f2(8 * L)}" fill="#0e7490"/>`; cols.forEach((c) => { s += T(c.t, x + 2, y + 5.4 * L, 3.8 * L, ' font-weight="700" fill="#fff"'); x += c.w * tw; }); y += 8 * L;
  };
  header(true);
  const meds = p.meds.length ? p.meds : (screen ? [{ name: 'Your medicines appear here', dose: '', times: {}, purpose: '', notes: '' }] : []);
  meds.forEach((md, idx) => {
    const cells = [[md.name, md.look].filter(Boolean).join(' – '), md.dose, timesText(md), md.purpose, md.notes].map((v, i) => wrap(v || '', fs, cols[i].w * tw - 4, i === 0 ? 600 : 400));
    const rh = Math.max(1, ...cells.map((c) => c.length)) * lh + 3;
    if (y + rh > H - 52) { pages.push(svgPage(W, H, s)); header(false); }
    if (idx % 2) s += `<rect x="${m}" y="${f2(y)}" width="${f2(tw)}" height="${f2(rh)}" fill="#f3f4f6"/>`;
    let x = m; cells.forEach((c, i) => { c.forEach((l, j) => { s += T(l, x + 2, y + 1.5 + fs + j * lh, fs, i === 0 ? ' font-weight="600"' : ''); }); x += cols[i].w * tw; });
    s += `<line x1="${m}" y1="${f2(y + rh)}" x2="${f2(m + tw)}" y2="${f2(y + rh)}" stroke="#d1d5db" stroke-width=".3"/>`;
    y += rh;
  });
  // contacts
  const cy = H - 46, c3 = tw / 3;
  [['Doctor', p.doctor, p.doctorPhone], ['Pharmacy', p.pharmacy, p.pharmacyPhone], ['Emergency contact', p.emergency, p.emergencyPhone]].forEach(([t, n, ph], i) => {
    const x = m + i * c3;
    s += `<rect x="${f2(x + 1)}" y="${cy}" width="${f2(c3 - 2)}" height="24" rx="2" fill="none" stroke="#9ca3af" stroke-width=".3"/>` + T(t, x + 4, cy + 6, 3.4, ' font-weight="700" fill="#0e7490"') + T(n || '', x + 4, cy + 13, fit(n || '', 4.4, c3 - 8, 600), ' font-weight="600"') + T(ph || '', x + 4, cy + 20, fit(ph || '', 4.4, c3 - 8));
  });
  s += T('Bring this list to every doctor visit, hospital stay and pharmacy.', m, H - 14, 3.6, ' fill="#333"');
  s += T(DISCLAIMER, m, H - 9, 3, ' fill="#666"');
  pages.push(svgPage(W, H, s));
  return pages;
}

// ---------- wallet card (front + back, fold in the middle; 2 copies per page) ----------
function cardFace(x, y, front, p, screen) {
  const w = 85.6, h = 54, pad = 3.5;
  let s = `<rect x="${f2(x)}" y="${f2(y)}" width="${w}" height="${h}" rx="3" fill="#fff" stroke="#9ca3af" stroke-width=".25" stroke-dasharray="1.2 1"/>`;
  if (front) {
    s += `<rect x="${f2(x)}" y="${f2(y)}" width="${w}" height="10" fill="#b91c1c"/>` + T('MEDICAL INFORMATION', x + w / 2, y + 6.8, 4, ' font-weight="800" fill="#fff" letter-spacing=".3"', 'middle');
    const lines = [[p.name || (screen ? 'Your name' : ''), 4.6, 700], [p.dob ? `Born ${p.dob}` : '', 3, 400], [`Allergies: ${p.allergies || 'none known'}`, 3.3, 700], [p.emergency ? `Emergency: ${p.emergency} ${p.emergencyPhone || ''}` : '', 3, 400], [p.doctor ? `Doctor: ${p.doctor} ${p.doctorPhone || ''}` : '', 3, 400]];
    let yy = y + 16.5;
    lines.forEach(([t, fs, wt]) => { if (!t) return; s += T(t, x + pad, yy, fit(t, fs, w - 2 * pad, wt), ` font-weight="${wt}"${t.startsWith('Allergies') ? ' fill="#991b1b"' : ''}`); yy += fs * 1.75; });
  } else {
    s += T('MY MEDICINES', x + pad, y + 6.5, 3.4, ' font-weight="800" fill="#0e7490"');
    const meds = p.meds, avail = h - 12, n = meds.length;
    const fs = Math.max(2.2, Math.min(3, avail / Math.max(1, n) / 1.4)), fitN = Math.floor(avail / (fs * 1.4));
    const shown = n > fitN ? meds.slice(0, fitN - 1) : meds;
    shown.forEach((md, i) => { const t = `${md.name}${md.dose ? ' ' + md.dose : ''} – ${timesText(md) || 'as directed'}`; s += T(t, x + pad, y + 11 + (i + 1) * fs * 1.4, fit(t, fs, w - 2 * pad)); });
    if (shown.length < n) s += T(`+ ${n - shown.length} more – see my full list`, x + pad, y + 11 + fitN * fs * 1.4, fs, ' font-style="italic"');
    if (!n && screen) s += T('Your medicines appear here', x + pad, y + 16, 3, ' fill="#9ca3af"');
  }
  return s;
}
function cardPages(screen) {
  const P = PAPERS[st.paper] || PAPERS.letter, W = P.w, H = P.h, p = person(), cx = (W - 2 * 85.6) / 2;
  let s = T('Wallet card – cut out along the dotted line and fold in the middle', W / 2, 16, 4, ' fill="#555"', 'middle');
  [24, 90].forEach((y0) => { s += cardFace(cx, y0, true, p, screen) + cardFace(cx + 85.6, y0, false, p, screen) + `<line x1="${f2(cx + 85.6)}" y1="${y0 - 3}" x2="${f2(cx + 85.6)}" y2="${y0 + 57}" stroke="#9ca3af" stroke-width=".3" stroke-dasharray="3 2"/>`; });
  return [svgPage(W, H, s)];
}
function pages(screen) { return st.mode === 'list' ? listPages(screen) : st.mode === 'card' ? cardPages(screen) : weekPages(screen); }
function limitReason() {
  if (unlocked()) return '';
  if (st.people.length > FREE_PEOPLE) return 'Keeping charts for more than one person is part of Pro.';
  if (person().meds.length > FREE_MEDS) return `The free version holds up to ${FREE_MEDS} medicines. Pro has no limit.`;
  if ((st.weeks | 0) > 1) return 'Printing several weeks at once is part of Pro. One week at a time is free.';
  return '';
}
if (typeof module !== 'undefined') module.exports = { pages, weekPages, listPages, cardPages, limitReason, person, startDate, monday, SLOTS, getSt: () => st, setSt: (o) => { Object.assign(st, o); }, setProState: (a, b) => { proAvailable = a; isPro = b; } };

if (typeof document !== 'undefined') (function () {
  let pgs = [], pageNo = 0, toastTimer, editing = null;
  window.toast = function (msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000); };
  const PF = ['name', 'dob', 'allergies', 'doctor', 'doctorPhone', 'pharmacy', 'pharmacyPhone', 'emergency', 'emergencyPhone'];
  function renderPage() {
    const p = pgs[pageNo];
    $('page').innerHTML = p.svg.replace(/ width="[\d.]+mm" height="[\d.]+mm"/, ` style="aspect-ratio:${p.w}/${p.h};width:min(100%, calc((100vh - 170px) * ${p.w / p.h}))"`);
    $('pager').textContent = pgs.length > 1 ? `Page ${pageNo + 1} of ${pgs.length}` : 'Preview';
    $('prev').disabled = pageNo === 0; $('next').disabled = pageNo >= pgs.length - 1;
  }
  function renderMeds() {
    const p = person();
    $('meds').innerHTML = p.meds.length ? p.meds.map((m) => `<li><span class="nm" data-id="${m.id}" title="Click to change">${esc(m.name || '(no name)')} <small>${esc([m.dose, timesText(m)].filter(Boolean).join(' · '))}</small></span><button data-del="${m.id}" title="Delete" aria-label="Delete">✕</button></li>`).join('') : '<li class="none">No medicines yet</li>';
  }
  window.renderAll = function () {
    const p = person();
    $('who').innerHTML = st.people.map((x) => `<option value="${x.id}">${esc(x.name || 'Unnamed')}</option>`).join('');
    $('who').value = p.id;
    PF.forEach((k) => { if (document.activeElement !== $(k)) $(k).value = p[k] || ''; });
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.m === st.mode));
    $('paper').value = st.paper; $('large').checked = !!st.large; $('weeks').value = String(st.weeks || 1);
    if (document.activeElement !== $('start')) { const d = startDate(); $('start').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
    $('weekF').hidden = st.mode !== 'week';
    renderMeds();
    pgs = pages(true); pageNo = Math.min(pageNo, pgs.length - 1);
    renderPage();
  };
  const change = () => { save(); renderAll(); };
  function printNow() {
    const r = limitReason(); if (r) { openPro(r); return; }
    const list = pages(false), p = list[0];
    $('pageRule').textContent = `@page { size: ${p.w}mm ${p.h}mm; margin: 0; } @media print { #printArea svg { width: ${p.w}mm !important; height: ${p.h}mm !important; } }`;
    $('printArea').innerHTML = list.map((x) => x.svg).join('');
    window.print();
  }
  function openMed(m) {
    editing = m ? m.id : null; $('mTitle').textContent = m ? 'Change this medicine' : 'Add a medicine';
    ['mName', 'mDose', 'mPurpose', 'mNotes', 'mLook'].forEach((id) => { $(id).value = m ? (m[id.slice(1).toLowerCase()] || '') : ''; });
    SLOTS.forEach((s) => { $('t_' + s.k).checked = !!(m && m.times && m.times[s.k]); });
    $('mNext').hidden = !!m; $('medDialog').showModal(); $('mName').focus();
  }
  function saveMed(again) {
    const p = person(), v = { name: $('mName').value.trim(), dose: $('mDose').value.trim(), purpose: $('mPurpose').value.trim(), notes: $('mNotes').value.trim(), look: $('mLook').value.trim(), times: {} };
    SLOTS.forEach((s) => { if ($('t_' + s.k).checked) v.times[s.k] = 1; });
    if (!v.name) { toast('Type the name of the medicine.'); return; }
    if (!Object.keys(v.times).length) { toast('Tick at least one time of day, or "Only when needed".'); return; }
    if (editing) { const m = p.meds.find((x) => x.id === editing); if (m) Object.assign(m, v); }
    else { if (!unlocked() && p.meds.length >= FREE_MEDS) { $('medDialog').close(); openPro(`The free version holds up to ${FREE_MEDS} medicines. Pro has no limit.`); return; } p.meds.push(Object.assign({ id: uid() }, v)); }
    change();
    if (again && !editing) { ['mName', 'mDose', 'mPurpose', 'mNotes', 'mLook'].forEach((id) => { $(id).value = ''; }); SLOTS.forEach((s) => { $('t_' + s.k).checked = false; }); $('mName').focus(); } else $('medDialog').close();
  }
  PF.forEach((k) => { $(k).oninput = () => { person()[k] = $(k).value; save(); pgs = pages(true); renderPage(); if (k === 'name') { const o = $('who').selectedOptions[0]; if (o) o.textContent = $(k).value || 'Unnamed'; } }; });
  $('who').onchange = () => { st.cur = $('who').value; pageNo = 0; change(); };
  $('addPerson').onclick = () => { if (!unlocked() && st.people.length >= FREE_PEOPLE) { openPro('Keeping charts for more than one person is part of Pro – handy for caregivers and couples.'); return; } const p = blankPerson(); st.people.push(p); st.cur = p.id; change(); $('name').focus(); };
  $('delPerson').onclick = () => { const p = person(); if (!confirm(`Delete ${p.name || 'this person'} and all their medicines?`)) return; st.people = st.people.filter((x) => x.id !== p.id); if (!st.people.length) st.people.push(blankPerson()); st.cur = st.people[0].id; change(); };
  document.querySelectorAll('#modes button').forEach((b) => { b.onclick = () => { st.mode = b.dataset.m; pageNo = 0; change(); }; });
  $('paper').onchange = () => { st.paper = $('paper').value; change(); };
  $('large').onchange = () => { st.large = $('large').checked; change(); };
  $('weeks').onchange = () => { st.weeks = Number($('weeks').value); pageNo = 0; change(); };
  $('start').onchange = () => { st.start = $('start').value; change(); };
  $('thisWeek').onclick = () => { st.start = ''; change(); };
  $('addMed').onclick = () => openMed(null);
  $('meds').addEventListener('click', (e) => { const p = person(); const del = e.target.dataset.del; if (del) { const m = p.meds.find((x) => x.id === del); if (m && confirm(`Delete ${m.name}?`)) { p.meds = p.meds.filter((x) => x.id !== del); change(); } return; } const nm = e.target.closest('.nm'); if (nm) openMed(p.meds.find((x) => x.id === nm.dataset.id)); });
  $('mSave').onclick = () => saveMed(false); $('mNext').onclick = () => saveMed(true); $('mCancel').onclick = () => $('medDialog').close();
  $('prev').onclick = () => { if (pageNo > 0) { pageNo--; renderPage(); } };
  $('next').onclick = () => { if (pageNo < pgs.length - 1) { pageNo++; renderPage(); } };
  $('printBtn').onclick = printNow;
  $('moreBtn').onclick = (e) => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
  document.addEventListener('click', () => { $('menu').hidden = true; });
  $('exBtn').onclick = () => { const p = person(); if (p.meds.length && !confirm('Replace the current details with an example?')) return; Object.assign(p, { name: 'Margaret Ellis', dob: '3/14/1948', allergies: 'Penicillin', doctor: 'Dr. Helen Brooks', doctorPhone: '(555) 019-9012', pharmacy: 'Main Street Pharmacy', pharmacyPhone: '(555) 012-3456', emergency: 'David Ellis (son)', emergencyPhone: '(555) 014-2233', meds: [{ id: uid(), name: 'Metformin', dose: '500 mg – 1 tablet', purpose: 'Blood sugar', times: { m: 1, e: 1 }, notes: 'With food', look: 'white oval' }, { id: uid(), name: 'Lisinopril', dose: '10 mg – 1 tablet', purpose: 'Blood pressure', times: { m: 1 }, notes: '', look: 'pink round' }, { id: uid(), name: 'Vitamin D', dose: '1000 IU', purpose: 'Bones', times: { n: 1 }, notes: '', look: '' }, { id: uid(), name: 'Atorvastatin', dose: '20 mg – 1 tablet', purpose: 'Cholesterol', times: { b: 1 }, notes: '', look: 'white' }, { id: uid(), name: 'Paracetamol', dose: '500 mg – 1 or 2 tablets', purpose: 'Pain', times: { p: 1 }, notes: 'No more than 8 in 24 hours', look: '' }] }); change(); };
  $('resetBtn').onclick = () => { if (confirm('Delete everything and start again?')) { try { localStorage.removeItem('medpress'); } catch (_) {} location.reload(); } };
  $('proBtn').onclick = () => { if (!isPro) openPro(''); };
  $('buyBtn').onclick = buyPro;
  $('restoreBtn').onclick = async () => { proMessage((await checkPro()) ? 'Pro is unlocked. ★' : 'No purchase was found on this Microsoft account.'); };
  $('closePro').onclick = () => $('proDialog').close();
  window.addEventListener('resize', () => renderPage());
  setPro(isPro);
  checkPro();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
