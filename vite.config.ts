import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // BASE_PATH=/OpenThings/app/ builds the GitHub Pages demo; the container serves from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
  // `npm run server` in another terminal: the dev app reaches sync, REST and MCP on its own origin.
  server: { proxy: { '/api': 'http://localhost:8080', '/mcp': 'http://localhost:8080' } },
  // Background agents keep git worktrees under .claude/; don't pick up their tests. server/ runs under bun test.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**', 'server/**'] },
})
