import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Setup } from './screens/Setup';
import { Play } from './screens/Play';
import { End } from './screens/End';

const router = createBrowserRouter([
  { path: '/', element: <Setup /> },
  { path: '/play', element: <Play /> },
  { path: '/done', element: <End /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
