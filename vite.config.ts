import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  // Served from pickplayground.com/selfriser/, so the build lands in a matching folder.
  build: { outDir: 'dist/selfriser', emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Selfriser',
        short_name: 'Selfriser',
        description: 'Live tower-laser level monitor for self-rising roofs',
        theme_color: '#111418',
        background_color: '#111418',
        display: 'standalone',
        orientation: 'any',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: { globPatterns: ['**/*.{js,mjs,css,html,svg,woff2}'], maximumFileSizeToCacheInBytes: 5_000_000 },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
