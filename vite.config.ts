/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works under GitHub Pages' /cycling/ subpath (or any host).
  base: './',
  test: { globals: true, environment: 'node' },
});
