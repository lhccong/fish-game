import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as esbuild } from 'esbuild';
import { defineConfig, type Plugin } from 'vite';

const appDir = path.dirname(fileURLToPath(import.meta.url));

function workerBundle(outDir: string): Plugin {
  const workerDir = path.resolve(appDir, 'src/worker');
  const workerEntry = path.join(workerDir, 'index.ts');

  return {
    name: 'parti-worker-bundle',
    buildStart() {
      // worker 已拆分为多个 ts 文件，全部纳入 watch，保证任一文件改动都会重建 room.worker.js
      for (const name of readdirSync(workerDir)) {
        if (name.endsWith('.ts')) this.addWatchFile(path.join(workerDir, name));
      }
    },
    async closeBundle() {
      const outfile = path.join(outDir, 'room.worker.js');
      await esbuild({
        entryPoints: [workerEntry],
        outfile,
        bundle: true,
        format: 'esm',
        target: 'es2022',
        sourcemap: false,
        external: ['@parti/worker-sdk'],
      });
      const source = readFileSync(outfile, 'utf8');
      writeFileSync(
        outfile,
        source.replace(
          /export\s*\{\s*([A-Za-z_$][\w$]*)\s+as\s+default\s*\};/,
          'export default $1;',
        ),
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const dev = process.env.PARTI_ROOM_DEV_OUT_DIR;
  const prod = process.env.PARTI_ROOM_BUILD_OUT_DIR;
  if (mode === 'room-dev' && !dev) throw new Error('PARTI_ROOM_DEV_OUT_DIR is required');
  if (mode === 'room-build' && !prod) throw new Error('PARTI_ROOM_BUILD_OUT_DIR is required');
  const outDir = mode === 'room-dev'
    ? dev!
    : mode === 'room-build'
      ? prod!
      : path.resolve(appDir, 'dist/package');

  return {
    base: './',
    plugins: [workerBundle(outDir)],
    build: {
      outDir,
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
  };
});