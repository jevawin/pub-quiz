import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Setup } from './screens/Setup';

const Placeholder = ({ name }: { name: string }) => <div>{name} placeholder</div>;

const router = createBrowserRouter([
  { path: '/', element: <Setup /> },
  { path: '/play', element: <Placeholder name="play" /> },
  { path: '/done', element: <Placeholder name="done" /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
