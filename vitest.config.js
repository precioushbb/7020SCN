import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],

  resolve: {
    alias: {
      stores: fileURLToPath(new URL('./src/stores', import.meta.url)),
    },
  },

  test: {
    environment: 'happy-dom',
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      reportOnFailure: true,
    },
    include: [
      'tests/unit/**/*.spec.js',
      'tests/unit/**/*.test.js',
      'tests/integration/**/*.spec.js',
      'tests/integration/**/*.test.js',
    ],

    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
