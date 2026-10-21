import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { FileTransfers } from './components/FileArea';

const Login = lazy(() => import('./pages/Login'));
const ImageStraightener = lazy(() => import('./pages/ImageStraightener'));
const DispatchParser = lazy(() => import('./pages/DispatchParser'));
const PalletSlips = lazy(() => import('./pages/PalletSlips'));
const ExcelCompare = lazy(() => import('./pages/ExcelCompare'));
const Settings = lazy(() => import('./pages/Settings'));
const NotionHealth = lazy(() => import('./pages/NotionHealth'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const AdminHub = lazy(() => import('./pages/AdminHub'));
const pages = {
  '/login.html': Login,
  '/admin/image-straightener.html': ImageStraightener,
  '/admin/dispatch-parser.html': DispatchParser,
  '/admin/pallet-slips.html': PalletSlips,
  '/admin/excel-compare.html': ExcelCompare,
  '/admin/settings.html': Settings,
  '/admin/notion-health.html': NotionHealth,
  '/admin/audit-log.html': AuditLog,
  '/admin/vehicles.html': Vehicles,
  '/admin/': AdminHub,
  '/admin/index.html': AdminHub,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><FileTransfers><Suspense fallback={null}><Page /></Suspense></FileTransfers></StrictMode>);
