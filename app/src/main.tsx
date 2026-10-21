import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

const Login = lazy(() => import('./pages/Login'));
const ImageStraightener = lazy(() => import('./pages/ImageStraightener'));
const pages = {
  '/login.html': Login,
  '/admin/image-straightener.html': ImageStraightener,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><Suspense fallback={null}><Page /></Suspense></StrictMode>);
