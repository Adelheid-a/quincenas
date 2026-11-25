'use strict';

/* ---------- quincenas ---------- */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const startOf = (y, m, h) => new Date(y, m - 1, h === 'a' ? 15 : Math.min(30, lastDay(y, m)));
const nextOf = ({ y, m, h }) => (h === 'a' ? { y, m, h: 'b' } : m === 12 ? { y: y + 1, m: 1, h: 'a' } : { y, m: m + 1, h: 'a' });
const keyOf = ({ y, m, h }) => `${y}-${pad(m)}-${h}`;

const QS = [];
for (let c = { ...PRIMERA }, i = 0; keyOf(c) <= keyOf(ULTIMA); c = nextOf(c), i++) {
  const n = nextOf(c);
  const end = startOf(n.y, n.m, n.h);
  end.setDate(end.getDate() - 1);
  QS.push({ ...c, index: i, key: keyOf(c), start: startOf(c.y, c.m, c.h), end });
}
const byKey = Object.fromEntries(QS.map((q) => [q.key, q]));

const fmtDay = (d) => `${d.getDate()} ${MESES[d.getMonth()]}`;
const money = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('es-MX');
const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };

function currentQ() {
  const t = today();
  return QS.find((q) => t >= q.start && t <= q.end) || (t < QS[0].start ? QS[0] : QS[QS.length - 1]);
}

// fecha real de un pago dentro de su quincena
function dateOf(q, day) {
  if (day == null) return null;
  if (q.h === 'a') return new Date(q.y, q.m - 1, day);
  const payB = Math.min(30, lastDay(q.y, q.m));
  if (day >= payB) return new Date(q.y, q.m - 1, day);
  return q.m === 12 ? new Date(q.y + 1, 0, day) : new Date(q.y, q.m, day);
}

/* ---------- estado guardado en el teléfono ---------- */
const STORE = 'quincenas-v1';
const blank = () => ({ paid: {}, edits: {}, fwd: {}, removed: {}, extras: {} });
let S;
try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { S = blank(); }
const save = () => localStorage.setItem(STORE, JSON.stringify(S));
const bucket = (obj, k) => (obj[k] ||= {});

function itemsFor(q) {
  const list = planFor(q).map((it) => {
    const rules = (S.fwd[it.id] || []).filter((r) => r.from <= q.key).sort((a, b) => (a.from < b.from ? -1 : 1));
    if (rules.length) it.amount = rules[rules.length - 1].amount;
    const e = S.edits[q.key]?.[it.id];
    if (e != null) it.amount = e;
    return it;
  });
  const extras = (S.extras[q.key] || []).map((x) => ({ ...x, extra: true }));
  return [...list, ...extras]
    .filter((it) => !S.removed[q.key]?.[it.id])
    .map((it) => ({ ...it, date: dateOf(q, it.day), paid: !!S.paid[q.key]?.[it.id] }));
}

function totals(q) {
  const items = itemsFor(q).filter((i) => i.amount > 0);
  const ingresos = INGRESO + extrasIngreso(q).reduce((s, x) => s + x.amount, 0);
  const asignado = items.reduce((s, i) => s + i.amount, 0);
  const pagado = items.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
  return { items, ingresos, asignado, pagado, porPagar: asignado - pagado, libre: ingresos - asignado };
}

function ahorroTotal() {
  let t = AHORRO_INICIAL;
  for (const q of QS) for (const i of itemsFor(q)) if (i.kind === 'ahorro' && i.paid) t += i.amount;
  return t;
}

/* ---------- vista ---------- */
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICON = {
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

let viewKey = null;

function route() {
  const h = location.hash;
  const cal = h.startsWith('#/calendario');
  document.querySelectorAll('.tabs a').forEach((a) => {
    if ((a.getAttribute('href') === '#/calendario') === cal) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  if (cal) return renderCalendar();
  const k = h.match(/^#\/q\/(\d{4}-\d{2}-[ab])$/)?.[1];
  renderQ(byKey[k] || currentQ());
}

function strip(q, items) {
  const days = [];
  for (let d = new Date(q.start); d <= q.end; d.setDate(d.getDate() + 1)) days.push(new Date(d));
  const t = today().getTime();
  const cells = days.map((d) => {
    const on = items.filter((i) => i.date && i.date.getTime() === d.getTime() && i.kind === 'pago');
    const done = on.length && on.every((i) => i.paid);
    const isToday = d.getTime() === t;
    const label = on.length || isToday || d.getTime() === q.start.getTime() ? d.getDate() : '';
    return `<li class="day${on.length ? ' has' : ''}${done ? ' done' : ''}${isToday ? ' today' : ''}"
      ${on.length ? `title="${esc(on.map((i) => i.name).join(', '))}"` : ''}>
      <span class="dot">${on.length > 1 ? `<b>${on.length}</b>` : ''}</span>
      <span class="num">${label}</span></li>`;
  }).join('');
  return `<ol class="strip" aria-hidden="true" style="--n:${days.length}">${cells}</ol>`;
}

function row(q, i) {
  const meta = i.kind === 'pago' ? (i.date ? fmtDay(i.date) : 'Esta quincena') : i.kind === 'aparta' ? 'Se usa el 30' : i.kind === 'ahorro' && !i.amount ? 'Toca ··· para poner un monto' : '';
  return `<li class="item${i.paid ? ' paid' : ''}${!i.amount ? ' zero' : ''}" data-id="${esc(i.id)}">
    <button class="check" role="checkbox" aria-checked="${i.paid}" ${!i.amount ? 'disabled' : ''}>
      <span class="ring" aria-hidden="true"></span>
      <span class="txt"><span class="name">${esc(i.name)}</span>${meta ? `<span class="meta">${meta}</span>` : ''}</span>
      <span class="amt">${money(i.amount)}</span>
    </button>
    <button class="more" aria-label="Editar ${esc(i.name)}">${ICON.edit}</button>
  </li>`;
}

function group(title, q, items, extraHtml = '') {
  if (!items.length && !extraHtml) return '';
  const sum = items.reduce((s, i) => s + i.amount, 0);
  return `<section class="group"><h2><span>${title}</span><span class="gsum">${money(sum)}</span></h2>
    <ul>${items.map((i) => row(q, i)).join('')}</ul>${extraHtml}</section>`;
}

function readout(q, T, all) {
  return `<section class="readout">
      <p class="label">Por pagar</p>
      <p class="fig">${money(T.porPagar)}</p>
      <dl class="stats">
        <div><dt>Entra</dt><dd>${money(T.ingresos)}</dd></div>
        <div><dt>Pagado</dt><dd>${money(T.pagado)}</dd></div>
        <div class="${T.libre < 0 ? 'neg' : ''}"><dt>${T.libre < 0 ? 'Te falta' : 'Sin asignar'}</dt><dd>${money(Math.abs(T.libre))}</dd></div>
      </dl>
      ${strip(q, all)}
    </section>`;
}

function renderQ(q, dir = 0) {
  viewKey = q.key;
  const T = totals(q);
  const all = itemsFor(q);
  const pagos = all.filter((i) => i.kind === 'pago').sort((a, b) => (a.date ?? q.end) - (b.date ?? q.end));
  const dia = all.filter((i) => i.kind === 'dia');
  const guard = all.filter((i) => i.kind === 'ahorro' || i.kind === 'aparta');
  const ix = q.index;
  const nota = notaFor(q);
  const extrasIn = extrasIngreso(q);
  const t = today();
  const tag = t >= q.start && t <= q.end ? 'ahora' : q.index === 0 && t < q.start ? 'la que sigue' : '';

  app.innerHTML = `
  <div class="view" data-dir="${dir}">
    <section class="q-head">
      <button class="nav" data-go="${ix - 1}" ${ix === 0 ? 'disabled' : ''} aria-label="Quincena anterior">${ICON.prev}</button>
      <div class="q-title">
        <p class="q-sub">Quincena del ${q.h === 'a' ? '15' : q.start.getDate()}${tag ? ` · <span class="now">${tag}</span>` : ''}</p>
        <h1>${fmtDay(q.start)} – ${fmtDay(q.end)}${q.end.getFullYear() !== 2026 ? ` <span class="yr">${q.end.getFullYear()}</span>` : ''}</h1>
      </div>
      <button class="nav" data-go="${ix + 1}" ${ix === QS.length - 1 ? 'disabled' : ''} aria-label="Quincena siguiente">${ICON.next}</button>
    </section>

    ${readout(q, T, all)}

    ${nota ? `<p class="nota">${esc(nota)}</p>` : ''}

    <div class="groups">
      ${group('Pagos', q, pagos, `<button class="add" data-add>${ICON.plus}<span>Agregar gasto</span></button>`)}
      ${group('Día a día', q, dia)}
      ${group('Ahorro y apartados', q, guard)}
      ${extrasIn.length ? `<p class="income-note">${extrasIn.map((x) => `+ ${money(x.amount)} ${esc(x.name.toLowerCase())}`).join(' · ')} ya van en “Entra”.</p>` : ''}
    </div>
  </div>`;
  if (location.hash !== `#/q/${q.key}`) history.replaceState(null, '', `#/q/${q.key}`);
}

function renderCalendar() {
  viewKey = null;
  const cur = currentQ().key;
  const rows = QS.map((q) => {
    const T = totals(q);
    const pagos = T.items.filter((i) => i.kind === 'pago');
    const dashes = pagos.map((i) => `<i class="${i.paid ? 'on' : ''}"></i>`).join('');
    const past = q.end < today();
    return `<li><a href="#/q/${q.key}" class="cal-row${q.key === cur ? ' cur' : ''}${past ? ' past' : ''}">
      <span class="cal-date">${fmtDay(q.start)} – ${fmtDay(q.end)}${q.start.getMonth() === 0 && q.h === 'a' ? ` <span class="yr">${q.start.getFullYear()}</span>` : ''}${q.key === cur ? ` <span class="cal-tag">· ${today() < q.start ? 'la que sigue' : 'ahora'}</span>` : ''}</span>
      <span class="cal-dash" aria-label="${pagos.filter((i) => i.paid).length} de ${pagos.length} pagos hechos">${dashes}</span>
      <span class="cal-num"><span class="cal-k">${T.libre < 0 ? 'Falta' : 'Sobra'}</span> ${money(Math.abs(T.libre))}</span>
    </a></li>`;
  }).join('');
  app.innerHTML = `
  <div class="view">
    <section class="readout cal-head">
      <p class="label">Ahorro acumulado</p>
      <p class="fig">${money(ahorroTotal())}</p>
      <p class="sub">Incluye los ${money(AHORRO_INICIAL)} que ya tenías y cada “Guardar en ahorro” que palomeas.</p>
    </section>
    <ol class="cal">${rows}</ol>
  </div>`;
}

/* ---------- interacción ---------- */
app.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) {
    const q = QS[+go.dataset.go];
    if (q) { renderQ(q, +go.dataset.go > byKey[viewKey].index ? 1 : -1); }
    return;
  }
  const check = e.target.closest('.check');
  if (check && viewKey) {
    const id = check.closest('.item').dataset.id;
    const b = bucket(S.paid, viewKey);
    if (b[id]) delete b[id]; else b[id] = 1;
    save();
    // solo cambia el renglón y la lectura de arriba, para que el punto se llene con su transición
    const li = check.closest('.item');
    li.classList.toggle('paid', !!b[id]);
    check.setAttribute('aria-checked', !!b[id]);
    const q = byKey[viewKey];
    const all = itemsFor(q);
    const tmp = document.createElement('div');
    tmp.innerHTML = readout(q, totals(q), all);
    const fresh = tmp.firstElementChild;
    // la tira conserva sus nodos: solo cambia la clase, así el punto se rellena con transición
    fresh.querySelectorAll('.day').forEach((d, n) => { app.querySelectorAll('.day')[n]?.classList.toggle('done', d.classList.contains('done')); });
    const old = app.querySelector('.readout');
    old.querySelector('.fig').textContent = fresh.querySelector('.fig').textContent;
    old.querySelector('.stats').replaceWith(fresh.querySelector('.stats'));
    return;
  }
  const more = e.target.closest('.more');
  if (more && viewKey) return openSheet(more.closest('.item').dataset.id);
  if (e.target.closest('[data-add]')) return openSheet(null);
});

// Re-render conservando el scroll y animando solo lo que cambió.
function refresh() {
  const y = window.scrollY;
  renderQ(byKey[viewKey]);
  app.querySelector('.view').dataset.dir = 'none';
  window.scrollTo(0, y);
}

// deslizar para cambiar de quincena
let sx = null, sy = null;
app.addEventListener('touchstart', (e) => { if (!viewKey) return; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
app.addEventListener('touchend', (e) => {
  if (sx == null || !viewKey) return;
  const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
  sx = null;
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  const q = QS[byKey[viewKey].index + (dx < 0 ? 1 : -1)];
  if (q) renderQ(q, dx < 0 ? 1 : -1);
});

/* ---------- hoja para editar o agregar ---------- */
const sheet = $('#sheet');
const form = $('#sheet form');
let editing = null;

function openSheet(id) {
  const q = byKey[viewKey];
  const it = id ? itemsFor(q).find((i) => i.id === id) : null;
  editing = { id, extra: it?.extra || !id };
  $('#sheet-title').textContent = it ? it.name : 'Agregar gasto';
  form.concepto.value = it?.name || '';
  form.amount.value = it ? it.amount : '';
  form.day.value = it?.date ? it.date.getDate() : '';
  form.fwd.checked = false;
  sheet.classList.toggle('is-extra', editing.extra);
  sheet.classList.toggle('is-new', !id);
  $('#sheet .fwd-row').hidden = editing.extra;
  $('#sheet [data-remove]').hidden = !id;
  sheet.showModal();
  if (!id) form.name.focus();
}

function closeSheet() {
  sheet.classList.add('closing');
  setTimeout(() => { sheet.classList.remove('closing'); sheet.close(); }, 200);
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = Math.max(0, Math.round(Number(String(form.amount.value).replace(/[^\d.]/g, '')) || 0));
  const k = viewKey;
  if (editing.extra) {
    const name = form.concepto.value.trim() || 'Gasto';
    const day = parseInt(form.day.value, 10);
    const list = (S.extras[k] ||= []);
    const ex = list.find((x) => x.id === editing.id);
    const data = { name, amount, kind: 'pago', day: day >= 1 && day <= 31 ? day : null };
    if (ex) Object.assign(ex, data); else list.push({ id: 'x' + Date.now().toString(36), ...data });
  } else if (form.fwd.checked) {
    const rules = (S.fwd[editing.id] || []).filter((r) => r.from < k);
    rules.push({ from: k, amount });
    S.fwd[editing.id] = rules;
    for (const q of QS) if (q.key >= k && S.edits[q.key]) delete S.edits[q.key][editing.id];
  } else {
    bucket(S.edits, k)[editing.id] = amount;
  }
  save();
  closeSheet();
  refresh();
});

$('#sheet [data-remove]').addEventListener('click', () => {
  const k = viewKey;
  if (editing.extra) S.extras[k] = (S.extras[k] || []).filter((x) => x.id !== editing.id);
  else bucket(S.removed, k)[editing.id] = 1;
  if (S.paid[k]) delete S.paid[k][editing.id];
  save();
  closeSheet();
  refresh();
});
$('#sheet [data-cancel]').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

window.addEventListener('hashchange', route);
route();
