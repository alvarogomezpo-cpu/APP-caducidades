// Envía a ntfy los avisos de caducidad que toquen ahora mismo.
// Lo ejecuta GitHub Actions cada 30 minutos (ver avisos.yml). No necesita instalar nada.
//
// Necesita una variable de entorno:
//   CONEXION  = el "código de conexión" que da la app en Ajustes > Sincronización (empieza por CAD1.)
// Opcional:
//   APP_URL   = dirección de la web, para que al tocar el aviso se abra la app
//   DRY_RUN=1 = no envía nada, solo enseña lo que enviaría

import { pathToFileURL } from 'node:url';

// Si un aviso debía salir hace menos de esto y no salió (por un retraso de GitHub), se envía igualmente.
const WINDOW_MS = 18 * 3600 * 1000;

/* ---------- zonas horarias ---------- */
export function tzOffsetMs(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(ts));
  const p = {};
  for (const x of parts) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

// Convierte "día y hora en la zona tz" al instante UTC (ms). Vale para días fuera de rango (d <= 0).
export function zonedTimeToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz);
  return t;
}

/* ---------- qué avisos tocan ---------- */
export function computeDue({ items, settings, sent, now }) {
  const tz = settings.tz || 'Europe/Madrid';
  const out = [];
  for (const it of items) {
    if (!it.date || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) continue;
    const [y, m, d] = it.date.split('-').map(Number);
    for (const r of settings.reminders || []) {
      const days = Number(r.days) || 0;
      const [hh, mm] = String(r.time || '09:00').split(':').map(Number);
      const due = zonedTimeToUtc(y, m, d - days, hh, mm, tz);
      const key = `s_${it.id}_${days}_${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}`;
      if (due <= now && now - due <= WINDOW_MS && !sent.has(key)) out.push({ key, item: it, days });
    }
  }
  return out;
}

// Agrupa por antelación: "Caduca mañana: Pollo, Leche"
export function buildMessages(due) {
  const groups = new Map();
  for (const x of due) {
    if (!groups.has(x.days)) groups.set(x.days, []);
    groups.get(x.days).push(x);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([days, list]) => ({
      days,
      keys: list.map(x => x.key),
      title: days === 0 ? 'Caduca hoy' : days === 1 ? 'Caduca mañana' : `Caduca en ${days} días`,
      message: [...new Set(list.map(x => x.item.name))].join(', ')
    }));
}

/* ---------- Firestore por REST ---------- */
function makeApi(cfg, home) {
  const base = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/homes/${home}`;
  const key = `key=${encodeURIComponent(cfg.apiKey)}`;
  return {
    async getDoc(path) {
      const r = await fetch(`${base}/${path}?${key}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`Firestore ${path}: ${r.status} ${await r.text()}`);
      return r.json();
    },
    async listItems() {
      const r = await fetch(`${base}/items?pageSize=300&${key}`);
      if (!r.ok) throw new Error(`Firestore items: ${r.status} ${await r.text()}`);
      const data = await r.json();
      return (data.documents || []).map(d => ({
        id: d.name.split('/').pop(),
        name: d.fields?.name?.stringValue || '',
        date: d.fields?.date?.stringValue || ''
      }));
    },
    async saveSent(keys) {
      const r = await fetch(`${base}/state/sent?updateMask.fieldPaths=json&${key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { json: { stringValue: JSON.stringify(keys) } } })
      });
      if (!r.ok) throw new Error(`Firestore state/sent: ${r.status} ${await r.text()}`);
    }
  };
}

function decodeConn(text) {
  // Quitamos espacios, tabulaciones y saltos de línea de más (pueden colarse al copiar en el móvil o al pegar en GitHub).
  const raw = String(text || '').replace(/\s+/g, '').replace(/^CAD1\./, '');
  if (!raw) throw new Error('El secreto CONEXION está vacío.');
  let o;
  try {
    o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch (e) {
    throw new Error('El secreto CONEXION no tiene un formato válido. Vuelve a copiar el código desde Ajustes → Sincronización y pégalo de nuevo, sin añadir ni quitar nada.');
  }
  if (!o.c || !o.c.projectId || !o.c.apiKey || !o.h) throw new Error('El código de conexión no es válido.');
  return { cfg: o.c, home: o.h };
}

/* ---------- ntfy ---------- */
async function sendNtfy(topic, msg, appUrl) {
  const body = {
    topic,
    title: msg.title,
    message: msg.message,
    tags: ['warning'],
    priority: msg.days <= 1 ? 4 : 3
  };
  if (appUrl) body.click = appUrl;
  const r = await fetch('https://ntfy.sh/', { method: 'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`ntfy: ${r.status} ${await r.text()}`);
}

/* ---------- principal ---------- */
export async function main(env = process.env, now = Date.now()) {
  if (!env.CONEXION) throw new Error('Falta el secreto CONEXION (mira el LEEME).');
  const { cfg, home } = decodeConn(env.CONEXION);
  const api = makeApi(cfg, home);

  const [items, settingsDoc, sentDoc] = await Promise.all([
    api.listItems(),
    api.getDoc('config/settings'),
    api.getDoc('state/sent')
  ]);

  if (!settingsDoc?.fields?.json?.stringValue) {
    console.log('Todavía no hay ajustes guardados. Abre la app, entra en Ajustes y suscríbete al canal de ntfy.');
    return;
  }
  const settings = JSON.parse(settingsDoc.fields.json.stringValue);
  if (!settings.topic) { console.log('Los ajustes no tienen canal de ntfy.'); return; }

  let sentList = [];
  try { sentList = JSON.parse(sentDoc?.fields?.json?.stringValue || '[]'); } catch { sentList = []; }
  const sent = new Set(sentList);

  const due = computeDue({ items, settings, sent, now });
  const messages = buildMessages(due);
  console.log(`${items.length} productos, ${(settings.reminders || []).length} preavisos, ${due.length} avisos pendientes.`);

  const newlySent = [];
  for (const msg of messages) {
    if (env.DRY_RUN === '1') {
      console.log(`[prueba] ${msg.title}: ${msg.message}`);
      continue;
    }
    try {
      await sendNtfy(settings.topic, msg, env.APP_URL);
      console.log(`Enviado: ${msg.title}: ${msg.message}`);
      newlySent.push(...msg.keys);
    } catch (e) {
      console.error(String(e.message || e));
    }
  }

  // Guardamos qué se ha enviado y olvidamos lo de productos que ya no existen.
  const ids = new Set(items.map(i => i.id));
  const next = [...sent, ...newlySent].filter(k => ids.has(k.split('_')[1]));
  const changed = next.length !== sentList.length || next.some(k => !sent.has(k));
  if (env.DRY_RUN !== '1' && changed) await api.saveSent(next);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(String(e.message || e)); process.exit(1); });
}
