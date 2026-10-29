import { addLink, normalizeSettings, openLink, pageNotes, serverError, serverRequest } from './lib.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const text = $('text');
const status = $('status');

let settings = normalizeSettings({});
let tab = null;

function show(msg, kind = '') {
  status.textContent = msg;
  status.className = kind;
}

const target = () => (settings.dump ? form.elements.target.value : 'inbox');

/** Hand an openthings:// link to Firefox, which asks once, then opens the app. */
async function openScheme(link) {
  try {
    if (tab?.id != null && /^https?:/i.test(tab.url ?? '')) {
      await browser.tabs.update(tab.id, { url: link });
      return;
    }
  } catch {
    // Fall through: some pages (about:, the new tab page) can't be navigated by extensions.
  }
  window.location.href = link;
}

async function add(e) {
  e.preventDefault();
  const value = text.value.trim();
  if (!value) return text.focus();
  const notes = $('includePage').checked ? pageNotes(tab) : '';
  const t = target();
  await browser.storage.local.set({ ...(settings.dump ? { target: t } : {}), includePage: $('includePage').checked });
  await browser.storage.session.remove('prefill');

  if (settings.mode === 'server') {
    $('add').disabled = true;
    show('Adding…');
    try {
      const { url, init } = serverRequest(settings.serverUrl, { text: value, notes, target: t });
      const res = await fetch(url, init);
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(serverError(res.status, body, location.origin));
      text.value = '';
      show(t === 'dump' ? 'Added to Brain Dump.' : 'Added.', 'ok');
      setTimeout(() => window.close(), 900);
    } catch (err) {
      show(err instanceof TypeError ? `Can't reach ${settings.serverUrl}. Check the server URL in Settings.` : String(err.message ?? err), 'error');
    } finally {
      $('add').disabled = false;
    }
    return;
  }

  await openScheme(addLink({ text: value, notes, target: t }));
  text.value = '';
  show('Sent to the OpenThings app. Nothing happened? Install the app, or use a server in Settings.', 'ok');
}

async function openApp() {
  if (settings.mode === 'server') {
    await browser.tabs.create({ url: settings.serverUrl });
    window.close();
  } else {
    await openScheme(openLink(target(), settings.dump));
  }
}

async function init() {
  const stored = await browser.storage.local.get(null);
  settings = normalizeSettings(stored);
  if (settings.mode === 'server' && !settings.serverUrl) settings.mode = 'app';
  $('mode').textContent = settings.mode === 'server' ? 'Server' : 'App';
  $('mode').title = settings.mode === 'server' ? settings.serverUrl : 'openthings:// links to the desktop or phone app';
  form.elements.target.value = settings.target;
  document.querySelector('.target').hidden = !settings.dump;
  $('includePage').checked = settings.includePage;
  [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  const { prefill } = await browser.storage.session.get('prefill');
  if (prefill?.text) {
    text.value = prefill.text;
    if (prefill.url && prefill.url !== tab?.url) tab = { url: prefill.url, title: prefill.title };
    $('includePage').checked = true;
  }
  await browser.action.setBadgeText({ text: '' });
  text.focus();
  text.select();
}

form.addEventListener('submit', add);
text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) form.requestSubmit();
});
$('open').addEventListener('click', openApp);
$('settings').addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
  window.close();
});
init();
