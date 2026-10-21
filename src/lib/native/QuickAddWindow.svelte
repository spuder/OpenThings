<script lang="ts">
  /**
   * The desktop app's floating quick-add window (label "quickadd"). It never opens the database:
   * the text goes to the main window, which parses it with the same parser and adds it through the
   * store, so there is one SQLite copy and one op log.
   */
  import { store } from '../store.svelte';
  import { today } from '../dates';
  import QuickAdd from '../ui/QuickAdd.svelte';
  import { invoke, listen } from './desktop';
  import { addLinkPrefill, parseRoute } from './snapshot';

  let opened = $state(0);

  const native = {
    submit: (text: string, keepOpen: boolean) => void invoke('submit_quick_add', { text, keepOpen }),
    close: () => void invoke('hide_quick_add'),
  };

  void listen<{ text: string; url?: string | null }>('ot://quick-add-open', ({ text, url }) => {
    store.day = today();
    // From an openthings://add link: its title, list, tags… become tokens to review.
    const r = url ? parseRoute(url) : null;
    store.quickAddPrefill = r?.kind === 'add' ? addLinkPrefill(r) : (text ?? '');
    opened++;
  });

  // Esc anywhere closes, even if the field lost focus.
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') native.close();
  }
</script>

<svelte:window onkeydown={onKey} onfocus={() => document.querySelector<HTMLInputElement>('input')?.focus()} />

{#key opened}
  <QuickAdd {native} />
{/key}
