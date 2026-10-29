<script lang="ts">
  /**
   * The desktop app's floating quick-add window (label "quickadd"). It never opens the database:
   * the text goes to the main window, which parses it with the same parser and adds it through the
   * store, so there is one SQLite copy and one op log.
   */
  import { store } from '../store.svelte';
  import { today } from '../dates';
  import { viewEnabled } from '../features.svelte';
  import QuickAdd from '../ui/QuickAdd.svelte';
  import { invoke, listen } from './desktop';
  import { addLinkPrefill, parseRoute } from './snapshot';

  let opened = $state(0);
  /** No typing since the last reset, so the window can be shown as it is. */
  let fresh = true;

  function reset(text: string) {
    store.day = today();
    store.quickAddPrefill = text;
    opened++;
    fresh = !text;
  }

  const native = {
    submit: (text: string, keepOpen: boolean) => void invoke('submit_quick_add', { text, keepOpen }),
    close: () => void invoke('hide_quick_add'),
  };

  // Reset when the window goes away rather than when it opens: macOS shows the last frame it drew
  // before the webview repaints, so resetting on open would flash the old text first.
  void listen<{ text: string; url?: string | null }>('ot://quick-add-open', ({ text, url }) => {
    // From an openthings://add link: its title, list, tags… become tokens to review.
    const r = url ? parseRoute(url) : null;
    const prefill = r?.kind === 'add' ? addLinkPrefill(r, today(), viewEnabled('dump')) : (text ?? '');
    if (prefill || !fresh) reset(prefill);
    else store.day = today();
  });

  // Esc anywhere closes, even if the field lost focus.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') native.close();
  }
</script>

<svelte:window
  onkeydown={onKey}
  oninput={() => (fresh = false)}
  onfocus={() => document.querySelector<HTMLInputElement>('input')?.focus()}
  onblur={() => reset('')}
/>

{#key opened}
  <QuickAdd {native} />
{/key}
