import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    ssr: true,
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'electron/main.ts'),
        preload: resolve(rootDir, 'electron/preload.ts'),
      },
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: '[name].cjs',
      },
    },
  },
});
