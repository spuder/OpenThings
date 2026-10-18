import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // BASE_PATH=/OpenThings/app/ builds the GitHub Pages demo; the container serves from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  // Background agents keep git worktrees under .claude/; don't pick up their tests.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
})
