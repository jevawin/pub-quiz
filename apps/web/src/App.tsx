import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Setup } from './screens/Setup';
import { Play } from './screens/Play';
import { End } from './screens/End';

const AdminTree = lazy(() => import('./screens/admin/AdminTree').then((m) => ({ default: m.AdminTree })));
const AdminCategory = lazy(() => import('./screens/admin/AdminCategory').then((m) => ({ default: m.AdminCategory })));

const AdminChanges = lazy(() => import('./screens/admin/AdminChanges').then((m) => ({ default: m.AdminChanges })));
const AdminRules = lazy(() => import('./screens/admin/AdminRules').then((m) => ({ default: m.AdminRules })));
const AdminSweeps = lazy(() => import('./screens/admin/AdminSweeps').then((m) => ({ default: m.AdminSweeps })));

const router = createBrowserRouter([
  { path: '/', element: <Setup /> },
  { path: '/play', element: <Play /> },
  { path: '/done', element: <End /> },
  { path: '/admin', element: <Suspense fallback={null}><AdminTree /></Suspense> },
  { path: '/admin/c/:slug', element: <Suspense fallback={null}><AdminCategory /></Suspense> },
  { path: '/admin/changes', element: <Suspense fallback={null}><AdminChanges /></Suspense> },
  { path: '/admin/rules', element: <Suspense fallback={null}><AdminRules /></Suspense> },
  { path: '/admin/sweeps', element: <Suspense fallback={null}><AdminSweeps /></Suspense> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
