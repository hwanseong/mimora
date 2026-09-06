import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const outputDirectory = await mkdtemp(
  path.join(os.tmpdir(), 'mimora-correctness-check-'),
);

try {
  await build({
    configFile: false,
    logLevel: 'warn',
    ssr: {
      noExternal: true,
    },
    build: {
      emptyOutDir: true,
      minify: false,
      outDir: outputDirectory,
      rollupOptions: {
        output: {
          entryFileNames: 'correctness-tests.mjs',
          format: 'es',
        },
      },
      ssr: path.resolve('scripts/.correctness-tests.ts'),
      target: 'node20',
    },
  });

  await import(
    `${pathToFileURL(path.join(outputDirectory, 'correctness-tests.mjs')).href}?run=${Date.now()}`
  );
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
