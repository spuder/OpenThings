import { handoffPage, handoffPlan, isOpenThingsLink } from './lib.js';

// Context menu: "Add to OpenThings" with the selected text (or the link or page) prefilled.
// It only fills the popup; nothing is added until you press Add.

const MENU = 'openthings-add';

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({ id: MENU, title: 'Add to OpenThings', contexts: ['selection', 'link', 'page'] });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU) return;
  const text = (info.selectionText || info.linkText || tab?.title || '').trim().slice(0, 500);
  const url = info.linkUrl || info.pageUrl || tab?.url || '';
  await browser.storage.session.set({ prefill: { text, url, title: tab?.title ?? '' } });
  try {
    await browser.action.openPopup();
  } catch {
    // Older Firefox: show a badge so you know to click the toolbar button.
    await browser.action.setBadgeText({ text: '1' });
  }
});

// openthings:// links from the popup open here, in a real tab, so Firefox's "allow this site to open
// the link with OpenThings?" prompt appears full-size in the window instead of cut off in the popup.
browser.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'openthings-handoff' || !isOpenThingsLink(msg.link)) return undefined;
  return handoff(msg.link, msg.tabId);
});

async function handoff(link, tabId) {
  const { handoffGranted = false, handoffCount = 0 } = await browser.storage.local.get(['handoffGranted', 'handoffCount']);
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabId != null ? await browser.tabs.get(tabId).catch(() => active) : active;
  await browser.storage.local.set({ handoffCount: handoffCount + 1 });
  for (const via of handoffPlan({ granted: handoffGranted, tabUrl: tab?.url })) {
    try {
      if (via === 'background') {
        // External protocols don't replace the document, so this page stays as it is.
        window.location.href = link;
      } else if (via === 'tab') {
        if (tab?.id == null) continue;
        await browser.tabs.update(tab.id, { url: link });
      } else {
        await browser.tabs.create({ url: browser.runtime.getURL(handoffPage(link)), active: true, index: tab ? tab.index + 1 : undefined, windowId: tab?.windowId });
      }
      return { via };
    } catch {
      // Try the next way (some pages can't be navigated by extensions: reader view, addons.mozilla.org).
    }
  }
  return { via: 'none' };
}
