import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.js'

// Single-file build for the hosted artifact: inline the lazily-loaded matrix
// chunk so the whole app is one self-contained bundle (no runtime fetches,
// which an artifact's CSP would block). The committed app keeps code-splitting.
export default mergeConfig(base, defineConfig({
  build: {
    outDir: 'dist-artifact',
    rollupOptions: { output: { inlineDynamicImports: true } },
    chunkSizeWarningLimit: 5000,
  },
}))
