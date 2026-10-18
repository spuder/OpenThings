import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // BASE_PATH=/OpenThings/app/ builds the GitHub Pages demo; the container serves from /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte()],
})
