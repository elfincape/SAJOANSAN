import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import { PAGE_PATHS, PAGE_TITLES } from './src/page-paths.ts';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'legacy-html-paths',
      enforce: 'post',
      generateBundle(_options, bundle) {
        const index = bundle['index.html'];
        if (!index || index.type !== 'asset')
          this.error('기본 HTML 빌드 결과가 없습니다.');
        const files = new Map<string, string>();
        for (const [path, page] of Object.entries(PAGE_PATHS))
          if (path.endsWith('/') || path.endsWith('.html'))
            files.set(
              path.slice(1) + (path.endsWith('/') ? 'index.html' : ''),
              PAGE_TITLES[page],
            );
        for (const [fileName, title] of files) {
          const escaped = title
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;'),
            source = String(index.source).replace(
              /<title>[\s\S]*?<\/title>/,
              '<title>' + escaped + '</title>',
            );
          if (fileName === 'index.html') index.source = source;
          else this.emitFile({ type: 'asset', fileName, source });
        }
      },
    },
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss({ content: ['./index.html', './src/**/*.{ts,tsx}'] }),
      ],
    },
  },
  build: { target: 'es2022' },
});
