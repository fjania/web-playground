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
        'end-grain-3d-compose': 'end-grain/3d-compose.html',
        'end-grain-3d-cut': 'end-grain/3d-cut.html',
        'end-grain-3d-arrange': 'end-grain/3d-arrange.html',
        'end-grain-3d-trim': 'end-grain/3d-trim.html',
      }
    }
  }
})
