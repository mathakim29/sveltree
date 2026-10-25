import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    lib: { entry: './src/index.js', name: 'Sveltree', fileName: 'index' },
    rollupOptions: { external: ['svelte'], output: { globals: { svelte: 'Svelte' } } }
  }
});
