import { cpSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('./repo-root', import.meta.url));
const output = resolve(root, 'dist');
const pages = readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.html') && !resolve(entry.parentPath).startsWith(output))
  .map((entry) => resolve(entry.parentPath, entry.name));

export default defineConfig({
  root,
  publicDir: false,
  appType: 'mpa',
  build: {
    target: 'es2022',
    outDir: output,
    emptyOutDir: true,
    rolldownOptions: { input: pages, external: /^https?:\/\// },
  },
  plugins: [{
    name: 'copy-download-templates',
    closeBundle() {
      for (const directory of ['assets', 'templates', 'sql']) {
        cpSync(resolve(root, directory), resolve(output, directory), { recursive: true });
      }
    },
  }],
});
