import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub project Pages serve from /<repo>/, so assets need that base.
// Overridable for local preview and for the single-file artifact build.
const base = process.env.VITE_BASE ?? '/budget-app/'

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // the single-file artifact build has no origin to host a SW: disable
      // generation there, but keep the virtual module resolvable
      disable: process.env.VITE_NO_PWA === '1',
      registerType: 'prompt', // we surface our own "new version — refresh" prompt
      injectRegister: null,   // registration is handled in src/pwa.js
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Peptide Command Center',
        short_name: 'Peptide CC',
        description: 'Personal peptide protocol tracker — dosing, injection-site rotation, mixing chemistry and body composition. Not medical advice.',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#080a12',
        background_color: '#080a12',
        categories: ['health', 'lifestyle', 'utilities'],
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the chemistry matrix ships as a ~1.8 MB chunk — precache it so the
        // Mix tab works with no connection
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: `${base}index.html`,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => ['style', 'script', 'worker'].includes(request.destination),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'pcc-assets' },
          },
          {
            urlPattern: ({ request }) => request.destination === 'image',
            handler: 'CacheFirst',
            options: {
              cacheName: 'pcc-images',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      devOptions: { enabled: false }, // keep the dev server SW-free
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
