import { defineConfig } from 'vite';

/*
 * `base` only applies to the production build. GitHub Pages serves the site
 * from /<repo>/, so built asset URLs need that prefix — but the dev server has
 * to stay on / or every local URL and every harness in dev/ breaks.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vollgas/' : '/',
  build: { chunkSizeWarningLimit: 900 },
}));
