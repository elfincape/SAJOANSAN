import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss({ content: ['./index.html', './src/**/*.{ts,tsx}'] })],
    },
  },
  build: { target: 'es2022' },
});
