import { FEATURE_CATALOG, FEATURE_CATEGORIES } from './repo-root/js/feature-catalog.mjs';
import { cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';

const root = fileURLToPath(new URL('./repo-root', import.meta.url));
const output = resolve(root, 'dist');
const pages = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.html') &&
      !resolve(entry.parentPath).startsWith(output),
  )
  .map((entry) => resolve(entry.parentPath, entry.name));

const featureIds = FEATURE_CATALOG.map((feature) => feature.id);
if (new Set(featureIds).size !== featureIds.length)
  throw new Error('기능 등록 ID가 중복되었습니다.');
const invalidFeatures = FEATURE_CATALOG.filter(
  (feature) =>
    !Object.hasOwn(FEATURE_CATEGORIES,feature.category) ||
    !feature.title ||
    typeof feature.defaultEnabled !== 'boolean' ||
    (feature.href?.startsWith('/admin/') &&
      feature.href !== '/admin/' &&
      !feature.resource),
);
if (invalidFeatures.length)
  throw new Error(
    '기능의 이름·기본값·권한 자원을 확인하세요: ' +
      invalidFeatures.map((feature) => feature.id).join(', '),
  );

const registeredAdminPages = new Set(
  FEATURE_CATALOG.flatMap((feature) => [feature.href, ...feature.aliases])
    .filter((path) => path?.startsWith('/admin/'))
    .map((path) => resolve(root, '.' + path.split('?')[0])),
);
const missingFeatures = pages.filter(
  (path) =>
    path.startsWith(resolve(root, 'admin') + '/') &&
    !registeredAdminPages.has(path),
);
if (missingFeatures.length)
  throw new Error(
    '관리 화면을 feature-catalog.mjs에 등록하세요: ' +
      missingFeatures.join(', '),
  );

export default defineConfig({
  root,
  publicDir: false,
  appType: 'mpa',
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: [
            resolve(root, '*.html'),
            resolve(root, 'admin/*.html'),
            resolve(root, 'js/**/*.js'),
          ],
        }),
      ],
    },
  },
  build: {
    target: 'es2022',
    outDir: output,
    emptyOutDir: true,
    rolldownOptions: { input: pages, external: /^https?:\/\// },
  },
  plugins: [
    {
      name: 'initial-workspace-theme',
      transformIndexHtml: {
        order: 'pre',
        handler(html) {
          if (!html.includes('/css/theme.css')) return html;
          return [
            {
              tag: 'script',
              children:
                "try{document.documentElement.dataset.theme=localStorage.getItem('sajo.appearance.v1')==='dark'?'dark':'light'}catch{}",
              injectTo: 'head-prepend',
            },
          ];
        },
      },
    },
    {
      name: 'copy-download-templates',
      closeBundle() {
        for (const directory of ['assets', 'templates', 'sql']) {
          cpSync(resolve(root, directory), resolve(output, directory), {
            recursive: true,
          });
        }
      },
    },
  ],
});
