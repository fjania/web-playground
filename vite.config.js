import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  server: {
    open: true
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
        'end-grain': 'end-grain/index.html'
      }
    }
  }
})
