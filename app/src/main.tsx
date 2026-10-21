import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const Login = lazy(() => import('./pages/Login'));
const ImageStraightener = lazy(() => import('./pages/ImageStraightener'));
const DispatchParser = lazy(() => import('./pages/DispatchParser'));
const PalletSlips = lazy(() => import('./pages/PalletSlips'));
const ExcelCompare = lazy(() => import('./pages/ExcelCompare'));
const Settings = lazy(() => import('./pages/Settings'));
const pages = {
  '/login.html': Login,
  '/admin/image-straightener.html': ImageStraightener,
  '/admin/dispatch-parser.html': DispatchParser,
  '/admin/pallet-slips.html': PalletSlips,
  '/admin/excel-compare.html': ExcelCompare,
  '/admin/settings.html': Settings,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><Suspense fallback={null}><Page /></Suspense></StrictMode>);
