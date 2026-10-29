import { normalizeServerUrl, normalizeSettings } from './lib.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const show = (msg, kind = '') => { $('status').textContent = msg; $('status').className = kind; };

$('origin').textContent = location.origin;

async function init() {
  const s = normalizeSettings(await browser.storage.local.get(null));
  form.elements.mode.value = s.mode;
  $('serverUrl').value = s.serverUrl;
}

/** Ask for access to the server's host (needs the click), so fetch from the popup is allowed. */
async function grant(url) {
  return browser.permissions.request({ origins: [`${new URL(url).origin}/*`] });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mode = form.elements.mode.value;
  const serverUrl = normalizeServerUrl($('serverUrl').value);
  if (mode === 'server' && !serverUrl) return show('Enter the server URL.', 'error');
  if (mode === 'server' && !(await grant(serverUrl))) return show('Firefox needs access to the server to add to-dos.', 'error');
  await browser.storage.local.set({ mode, serverUrl });
  $('serverUrl').value = serverUrl;
  show('Saved.', 'ok');
});

$('test').addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl($('serverUrl').value);
  if (!serverUrl) return show('Enter the server URL.', 'error');
  if (!(await grant(serverUrl))) return show('Firefox needs access to the server.', 'error');
  try {
    const res = await fetch(`${serverUrl}/api/v1/tasks?view=inbox&limit=1`);
    const body = await res.json().catch(() => null);
    if (res.status === 403) return show(`${body?.error ?? 'Refused'}: add ${location.origin} to OPENTHINGS_ALLOWED_ORIGINS.`, 'error');
    show(res.ok ? 'Connected.' : `HTTP ${res.status}`, res.ok ? 'ok' : 'error');
  } catch {
    show(`Can't reach ${serverUrl}.`, 'error');
  }
});

init();
