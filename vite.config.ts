import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import {defineConfig, loadEnv} from 'vite';

const runtimeAssets = [
  {
    outputDir: 'vad-assets',
    sourceDir: path.resolve(__dirname, 'node_modules/@ricky0123/vad-web/dist'),
    files: ['vad.worklet.bundle.min.js', 'silero_vad_legacy.onnx', 'silero_vad_v5.onnx'],
  },
  {
    outputDir: 'ort-assets',
    sourceDir: path.resolve(__dirname, 'node_modules/onnxruntime-web/dist'),
    files: [
      'ort-wasm-simd-threaded.mjs',
      'ort-wasm-simd-threaded.wasm',
      'ort-wasm-simd-threaded.jsep.mjs',
      'ort-wasm-simd-threaded.jsep.wasm',
    ],
  },
];

// vad-web loads its worklet/model/WASM files by URL at runtime. Vite does not
// discover those files from the JS import, so explicitly serve them in dev and
// emit them into the production bundle (including the GitHub Pages subpath).
const runtimeAssetPlugin = () => ({
  name: 'swifttranslate-runtime-assets',
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      const pathname = decodeURIComponent((req.url || '').split('?')[0]);
      for (const group of runtimeAssets) {
        const prefix = `/${group.outputDir}/`;
        if (!pathname.startsWith(prefix)) continue;
        const file = pathname.slice(prefix.length);
        if (!group.files.includes(file)) break;
        const source = path.join(group.sourceDir, file);
        res.setHeader(
          'Content-Type',
          file.endsWith('.wasm')
            ? 'application/wasm'
            : file.endsWith('.onnx')
              ? 'application/octet-stream'
              : 'text/javascript',
        );
        fs.createReadStream(source).pipe(res);
        return;
      }
      next();
    });
  },
  generateBundle(this: any) {
    for (const group of runtimeAssets) {
      for (const file of group.files) {
        this.emitFile({
          type: 'asset',
          fileName: `${group.outputDir}/${file}`,
          source: fs.readFileSync(path.join(group.sourceDir, file)),
        });
      }
    }
  },
});

export default defineConfig(({mode, command}) => {
  const env = loadEnv(mode, '.', '');
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
  return {
    // Served at the repo subpath on GitHub Pages; root in dev/preview.
    base: command === 'build' ? '/SuperTranslater/' : '/',
    plugins: [react(), tailwindcss(), runtimeAssetPlugin()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
      '__APP_VERSION__': JSON.stringify(pkg.version || '0.0.0'),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/openai/, ''),
        },
        '/api/anthropic': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
        },
      },
    },
  };
});
