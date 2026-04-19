import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig({
  base: './',
  plugins: [svelte()],
  esbuild: {
    jsxImportSource: 'preact',
    jsx: 'automatic',
  },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        'dst-visualization': 'dst-visualization/index.html',
        'wordcloud': 'wordcloud/index.html',
        'tapestry': 'tapestry/index.html',
        'viewmaster-small': 'viewmaster/small.html',
        'viewmaster-large': 'viewmaster/large.html',
        'cubewise': 'cubewise/index.html',
        'end-grain': 'end-grain/index.html',
        'end-grain-3d': 'end-grain/3d.html',
        'end-grain-3d-v2': 'end-grain/3d-v2.html',
        'end-grain-3d-v2-arrange': 'end-grain/3d-v2-arrange.html',
        'end-grain-3d-v2-trim': 'end-grain/3d-v2-trim.html',
        'end-grain-3d-v2-compose': 'end-grain/3d-v2-compose.html',
      }
    }
  }
})
