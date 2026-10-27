import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at /daisy-and-co/
export default defineConfig({
  base: '/daisy-and-co/',
  plugins: [react()],
});
