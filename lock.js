'use strict';
// Candado: el plan viaja cifrado (plan.enc.json). Con el PIN correcto se descifra una vez
// y se guarda en este teléfono para abrir sin volver a pedirlo.

const PLAN_KEY = 'quincenas-plan';
const PIN_LEN = 6;

function loadScript(src, text) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    if (text != null) { s.textContent = text; document.body.appendChild(s); ok(); return; }
    s.src = src; s.onload = ok; s.onerror = fail;
    document.body.appendChild(s);
  });
}

async function start(planText) {
  document.body.classList.remove('locked');
  document.getElementById('lock')?.remove();
  await loadScript(null, planText);
  await loadScript('app.js');
}

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(pin) {
  let res = await fetch('plan.enc.json', { cache: 'no-cache' }).catch(() => null);
  if ((!res || !res.ok) && 'caches' in window) res = await caches.match('plan.enc.json');
  if (!res) throw new Error('sin plan');
  const box = await res.json();
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(box.salt), iterations: box.iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(box.iv) }, key, b64(box.ct));
  return new TextDecoder().decode(plain);
}

function lockScreen() {
  document.body.classList.add('locked');
  const el = document.getElementById('lock');
  el.hidden = false;
  const dots = el.querySelectorAll('.pin-dots i');
  const msg = el.querySelector('.pin-msg');
  let pin = '';
  let busy = false;

  const paint = () => dots.forEach((d, i) => d.classList.toggle('on', i < pin.length));

  async function tryPin() {
    busy = true;
    el.classList.add('busy');
    msg.textContent = 'Abriendo…';
    try {
      const text = await decrypt(pin);
      localStorage.setItem(PLAN_KEY, text);
      await start(text);
    } catch {
      el.classList.remove('busy');
      msg.textContent = 'PIN incorrecto. Prueba otra vez.';
      const row = el.querySelector('.pin-dots');
      row.classList.remove('shake'); void row.offsetWidth; row.classList.add('shake');
      pin = ''; paint(); busy = false;
    }
  }

  function press(k) {
    if (busy) return;
    if (k === 'del') pin = pin.slice(0, -1);
    else if (pin.length < PIN_LEN) pin += k;
    if (pin.length === 1) msg.textContent = 'Escribe tu PIN';
    paint();
    if (pin.length === PIN_LEN) tryPin();
  }

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', (e) => {
    if (!document.body.classList.contains('locked')) return;
    if (/^\d$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') press('del');
  });
}

const saved = localStorage.getItem(PLAN_KEY);
if (saved) start(saved); else lockScreen();

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
