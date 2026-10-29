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
