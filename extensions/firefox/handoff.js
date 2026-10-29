import { isOpenThingsLink } from './lib.js';

// Opened by the background script for pages it can't hand the link to (about:, the new tab page).
// This is a normal tab, so Firefox's permission prompt has room to show.
const link = new URLSearchParams(location.search).get('to') ?? '';
const msg = document.getElementById('msg');

const go = () => {
  if (isOpenThingsLink(link)) location.href = link;
};

document.getElementById('retry').addEventListener('click', go);
document.getElementById('close').addEventListener('click', () => window.close());

if (isOpenThingsLink(link)) {
  // Give the tab a moment to show, so the prompt attaches to it.
  setTimeout(go, 150);
} else {
  msg.textContent = 'Nothing to open.';
  document.getElementById('retry').hidden = true;
}
