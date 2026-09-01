const esbuild = require('esbuild');
const fs = require('node:fs/promises');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const watchPlugin = {
  name: 'watch-plugin',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

const removeLegacyRuntimePlugin = {
  name: 'remove-legacy-runtime',
  setup(build) {
    build.onStart(async () => {
      await Promise.all([
        fs.rm('dist/webview', { recursive: true, force: true }),
        fs.rm('dist/native', { recursive: true, force: true }),
        fs.rm('dist/presence-worker.js', { force: true }),
        fs.rm('dist/presence-worker.js.map', { force: true }),
      ]);
    });
  },
};

async function main() {
  const contexts = await Promise.all([
    esbuild.context({
      entryPoints: ['src/extension.ts'],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node20',
      outfile: 'dist/extension.js',
      external: ['vscode'],
      minify: production,
      sourcemap: !production,
      sourcesContent: false,
      logLevel: 'silent',
      plugins: [watchPlugin, removeLegacyRuntimePlugin],
    }),
  ]);

  if (watch) {
    await Promise.all(contexts.map((context) => context.watch()));
  } else {
    await Promise.all(contexts.map((context) => context.rebuild()));
    await Promise.all(contexts.map((context) => context.dispose()));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
