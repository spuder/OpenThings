/**
 * Opens an `openthings://` link in the app: the iOS app (appUrlOpen, App Intents) and the desktop
 * app's main window (deep links forwarded by the Rust shell as `ot://open-url`). The parsing is in
 * `snapshot.ts` (`parseRoute`), which has the tests. See docs/url-scheme.md.
 */
import { viewEnabled } from '../features.svelte';
import { store } from '../store.svelte';
import { pairing } from '../sync/pairing.svelte';
import { addLinkParsed, addLinkPrefill, parseRoute } from './snapshot';

/** Returns false when the link isn't one OpenThings knows. */
export function openRoute(url: string): boolean {
  const r = parseRoute(url);
  if (!r) return false;
  if (r.kind === 'task') store.reveal(r.id);
  else if (r.kind === 'view') store.go({ kind: r.view });
  else if (r.kind === 'pair') {
    pairing.server = r.server;
    store.go({ kind: 'settings' });
  } else if (r.save) {
    const p = addLinkParsed(r, store.day, viewEnabled('dump'));
    if (!p.title) {
      store.notify('Nothing to add: the link has no title');
      return true;
    }
    // From outside the app: a to-do without a list goes to the Inbox, not the list on screen.
    store.addParsed(p, { useContext: false });
    store.notify(`Added “${p.title}”`);
  } else {
    store.openQuickAdd(addLinkPrefill(r, store.day, viewEnabled('dump')));
  }
  return true;
}
