import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const Login = lazy(() => import('./pages/Login'));
const ImageStraightener = lazy(() => import('./pages/ImageStraightener'));
const DispatchParser = lazy(() => import('./pages/DispatchParser'));
const PalletSlips = lazy(() => import('./pages/PalletSlips'));
const pages = {
  '/login.html': Login,
  '/admin/image-straightener.html': ImageStraightener,
  '/admin/dispatch-parser.html': DispatchParser,
  '/admin/pallet-slips.html': PalletSlips,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><Suspense fallback={null}><Page /></Suspense></StrictMode>);
