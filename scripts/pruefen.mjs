// Fragt jede Seite aus der Liste ab, hängt das Ergebnis an den Verlauf und schreibt ihn verschlüsselt nach <ausgabe>/data.json.
// Aufruf: node scripts/pruefen.mjs <domains.txt> <ausgabe>, mit STATUS_PASSWORD und PREV_URL (die data.json der laufenden Seite).
// Die Logs eines öffentlichen Repositories kann jeder lesen: Hier wird kein Host ausgegeben, nur Zahlen.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { webcrypto as crypto } from 'node:crypto';

const ITER = 600000; // PBKDF2-SHA256, Empfehlung von OWASP
const RECENT = 288; // letzte 24 Stunden bei einem Lauf alle 5 Minuten
const TAGE = 90;

const [liste, ausgabe] = process.argv.slice(2);
const passwort = process.env.STATUS_PASSWORD;
if (!liste || !ausgabe || !passwort) {
  console.error('Aufruf: node scripts/pruefen.mjs <domains.txt> <ausgabe>, STATUS_PASSWORD muss gesetzt sein.');
  process.exit(2);
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function schluessel(salt) {
  const roh = await crypto.subtle.importKey('raw', new TextEncoder().encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER },
    roh,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Den bisherigen Verlauf von der laufenden Seite holen. Passt das Passwort nicht mehr (geändert) oder gibt es noch
// keine Seite, beginnt der Verlauf neu, mit neuem Salt.
async function bisher() {
  if (!process.env.PREV_URL) return null;
  try {
    // Pages liefert Dateien mit max-age=600; der Parameter holt den Stand des letzten Deploys.
    const res = await fetch(`${process.env.PREV_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
    if (!res.ok) return null;
    const env = await res.json();
    if (env.v !== 1 || env.iter !== ITER) return null;
    const salt = unb64(env.salt);
    const key = await schluessel(salt);
    const klar = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct));
    return { salt, key, state: JSON.parse(new TextDecoder().decode(klar)) };
  } catch {
    return null;
  }
}

async function frage(host) {
  const start = Date.now();
  try {
    // Wie uptime.yml in netcup-deploy: keine Weiterleitung folgen, eine 301 zählt als Antwort.
    const res = await fetch(`https://${host}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: { 'user-agent': 'dstN-status' },
    });
    await res.body?.cancel();
    return { code: res.status, ms: Date.now() - start };
  } catch {
    return { code: 0, ms: Date.now() - start };
  }
}

// 000 und 5xx sind ein Ausfall; 401 und 403 nicht, weil Vorschauen hinter einem Passwort liegen.
const unten = (code) => code === 0 || code >= 500;

async function pruefe(host) {
  let r = await frage(host);
  if (unten(r.code)) {
    // Der zweite Versuch deckt eine 500 oder ein Timeout ab, während Passenger eine schlafende App startet.
    await new Promise((ok) => setTimeout(ok, 20000));
    r = await frage(host);
  }
  return r;
}

const hosts = (await readFile(liste, 'utf8'))
  .split('\n')
  .map((z) => z.replace(/\r$/, '').trim())
  .filter((z) => z && !z.startsWith('#'));

const alt = await bisher();
const salt = alt?.salt ?? crypto.getRandomValues(new Uint8Array(16));
const key = alt?.key ?? (await schluessel(salt));
const state = alt?.state ?? { sites: {} };
console.log(alt ? 'Verlauf übernommen.' : 'Kein lesbarer Verlauf, beginne neu.');

const jetzt = Math.floor(Date.now() / 1000);
const tag = new Date(jetzt * 1000).toISOString().slice(0, 10);
const grenze = new Date((jetzt - TAGE * 86400) * 1000).toISOString().slice(0, 10);

const ergebnisse = await Promise.all(hosts.map(pruefe));
const sites = {};
hosts.forEach((host, i) => {
  const { code, ms } = ergebnisse[i];
  const ok = !unten(code);
  const s = state.sites[host] ?? { recent: [], days: {} };
  s.recent.push([jetzt, code, ms]);
  s.recent = s.recent.slice(-RECENT);
  const d = s.days[tag] ?? [0, 0];
  s.days[tag] = [d[0] + (ok ? 1 : 0), d[1] + 1];
  for (const t of Object.keys(s.days)) if (t < grenze) delete s.days[t];
  if (!ok && (s.downSince == null)) s.downSince = jetzt;
  if (ok) delete s.downSince;
  sites[host] = s; // Hosts, die aus der Liste verschwunden sind, fallen so heraus.
});

const klar = new TextEncoder().encode(JSON.stringify({ updated: jetzt, sites }));
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, klar);

await mkdir(ausgabe, { recursive: true });
await writeFile(`${ausgabe}/data.json`, JSON.stringify({ v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) }));

const down = ergebnisse.filter((r) => unten(r.code)).length;
console.log(`${hosts.length} Seiten geprüft, ${hosts.length - down} erreichbar, ${down} nicht.`);
