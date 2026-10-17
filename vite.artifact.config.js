import { defineConfig, mergeConfig } from 'vite'
import baseConfig from './vite.config.js'

// Single-file build for the hosted artifact: inline the lazily-loaded chunks so
// the whole app is one self-contained document (no runtime fetches, which the
// artifact CSP blocks). The committed app keeps code-splitting + the PWA.
export default defineConfig((env) => mergeConfig(baseConfig(env), {
  base: './',
  // a service worker and manifest make no sense in a single inlined file —
  // the build script sets VITE_NO_PWA=1, which disables generation upstream
  
  build: {
    outDir: 'dist-artifact',
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 5000,
  },
})
