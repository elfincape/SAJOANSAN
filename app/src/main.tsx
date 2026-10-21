import { lazy, StrictMode, Suspense } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { FileTransfers } from './components/FileArea';
import { PAGE_PATHS, pageTitle } from './page-paths';
const modules = import.meta.glob<{ default: ComponentType }>('./pages/*.tsx');
const name = PAGE_PATHS[location.pathname as keyof typeof PAGE_PATHS],
  loader = name ? modules['./pages/' + name + '.tsx'] : undefined,
  Page = loader ? lazy(loader) : null;
document.title = pageTitle(location.pathname) ?? document.title;
if (Page)
  createRoot(document.body).render(
    <StrictMode>
      <FileTransfers>
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      </FileTransfers>
    </StrictMode>,
  );
