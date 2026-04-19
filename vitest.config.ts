import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Archive holds the pre-v2 code + tests. We keep it around for
    // reference but it isn't wired into the live build; skip it
    // during test discovery so renames/promotions don't rot it.
    exclude: ['**/node_modules/**', '**/dist/**', '**/archive/**'],
  },
});
