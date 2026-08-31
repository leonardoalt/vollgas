import { defineConfig } from 'vite';

/*
 * `base` only applies to the production build. GitHub Pages serves the site
 * from /<repo>/, so built asset URLs need that prefix — but the dev server has
 * to stay on / or every local URL and every harness in dev/ breaks.
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/vollgas/' : '/',
  /* .glb is not in Vite's default asset list, so an `import x from './a.glb'`
     is otherwise parsed as a module and 500s. Listing it here makes the import
     resolve to a URL, which is what GLTFLoader wants, and lets the build hash
     and emit the file. */
  assetsInclude: ['**/*.glb'],
  build: { chunkSizeWarningLimit: 900 },
}));
