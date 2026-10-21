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
const Companies = lazy(() => import('./pages/Companies'));
const DeliveryPoints = lazy(() => import('./pages/DeliveryPoints'));
const Routes = lazy(() => import('./pages/Routes'));
const RouteEdit = lazy(() => import('./pages/RouteEdit'));
const CourseImport = lazy(() => import('./pages/CourseImport'));
const CourseExport = lazy(() => import('./pages/CourseExport'));
const Users = lazy(() => import('./pages/Users'));
const Drivers = lazy(() => import('./pages/Drivers'));
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
  '/admin/companies.html': Companies,
  '/admin/drivers.html': Drivers,
  '/admin/delivery-points.html': DeliveryPoints,
  '/admin/routes.html': Routes,
  '/admin/users.html': Users,
  '/admin/export.html': CourseExport,
  '/admin/import.html': CourseImport,
  '/admin/route-edit.html': RouteEdit,
  '/admin/': AdminHub,
  '/admin/index.html': AdminHub,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><FileTransfers><Suspense fallback={null}><Page /></Suspense></FileTransfers></StrictMode>);
