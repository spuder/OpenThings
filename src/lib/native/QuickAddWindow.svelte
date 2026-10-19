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

  let opened = $state(0);

  const native = {
    submit: (text: string, keepOpen: boolean) => void invoke('submit_quick_add', { text, keepOpen }),
    close: () => void invoke('hide_quick_add'),
  };

  void listen<{ text: string }>('ot://quick-add-open', ({ text }) => {
    store.day = today();
    store.quickAddPrefill = text ?? '';
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
