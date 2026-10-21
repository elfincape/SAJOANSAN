import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { FileTransfers } from './components/FileArea';

const GimhaeDispatch = lazy(() => import('./pages/GimhaeDispatch'));
const PyeongtaekDispatch = lazy(() => import('./pages/PyeongtaekDispatch'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Operations = lazy(() => import('./pages/Operations'));
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
const CharterParser = lazy(() => import('./pages/CharterParser'));
const NaverDistance = lazy(() => import('./pages/NaverDistance'));
const DistanceCalculator = lazy(() => import('./pages/DistanceCalculator'));
const KakaoRoutes = lazy(() => import('./pages/KakaoRoutes'));
const HaulCalculator = lazy(() => import('./pages/HaulCalculator'));
const PdfTools = lazy(() => import('./pages/PdfTools'));
const CoupangEntry = lazy(() => import('./pages/CoupangEntry'));
const OneTopWork = lazy(() => import('./pages/OneTopWork'));
const DailyTemperature = lazy(() => import('./pages/DailyTemperature'));
const Transfers = lazy(() => import('./pages/Transfers'));
const CourseImport = lazy(() => import('./pages/CourseImport'));
const CourseExport = lazy(() => import('./pages/CourseExport'));
const Users = lazy(() => import('./pages/Users'));
const Drivers = lazy(() => import('./pages/Drivers'));
const AdminHub = lazy(() => import('./pages/AdminHub'));
const pages = {
  '/login.html': Login,
  '/admin/operations.html': Operations,
  '/': Dashboard,
  '/index.html': Dashboard,
  '/admin/pyeongtaek-dispatch.html': PyeongtaekDispatch,
  '/admin/gimhae-dispatch.html': GimhaeDispatch,
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
  '/admin/transfers.html': Transfers,
  '/admin/daily-temperature.html': DailyTemperature,
  '/admin/one-top-two-room-work.html': OneTopWork,
  '/admin/coupang-entry.html': CoupangEntry,
  '/admin/pdf-image-converter.html': PdfTools,
  '/admin/haul-dispatch-calculator.html': HaulCalculator,
  '/admin/ansan-gimhae-busan-ansan.html': KakaoRoutes,
  '/admin/charter-fuel-estimator.html': DistanceCalculator,
  '/admin/naver-shortest-distance.html': NaverDistance,
  '/admin/pyeongtaek-charter-parser.html': CharterParser,
  '/admin/route-edit.html': RouteEdit,
  '/admin/': AdminHub,
  '/admin/index.html': AdminHub,
};
const Page = pages[location.pathname as keyof typeof pages];
if (Page) createRoot(document.body).render(<StrictMode><FileTransfers><Suspense fallback={null}><Page /></Suspense></FileTransfers></StrictMode>);
