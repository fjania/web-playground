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
    // Top-level `await initManifold()` in each end-grain main-*.ts
    // requires a target that supports top-level await. esbuild's
    // default is es2020 which doesn't. esnext covers every modern
    // browser that can also run WebGL2 + WebAssembly, which is our
    // de-facto floor for end-grain anyway. (#41)
    target: 'esnext',
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
