<script lang="ts">
  let { code, label = '' }: { code: string; label?: string } = $props();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard API needs HTTPS; fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="code">
  <div class="head">
    <span>{label}</span>
    <button onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
  </div>
  <pre><code>{code}</code></pre>
</div>

<style>
  .code {
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    overflow: hidden;
    margin: 10px 0;
    background: var(--chip);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 8px 5px 12px;
    font-size: 11.5px;
    color: var(--text-3);
    border-bottom: 1px solid var(--line);
  }
  button {
    font-size: 12px;
    color: var(--accent);
    padding: 2px 8px;
    border-radius: 6px;
  }
  button:hover {
    background: var(--bg);
  }
  pre {
    margin: 0;
    padding: 10px 12px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.5;
  }
  code {
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }
</style>
