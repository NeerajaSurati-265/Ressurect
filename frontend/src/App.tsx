import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Landing } from './routes/Landing'
import { NotFound } from './routes/NotFound'
import { ResurrectionView } from './routes/ResurrectionView'

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <Landing /> },
      { path: 'r/:id', element: <ResurrectionView /> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <LazyMotion features={domAnimation}>
      {/* With prefers-reduced-motion, transforms are skipped and state changes become fades. */}
      <MotionConfig reducedMotion="user">
        <RouterProvider router={router} />
      </MotionConfig>
    </LazyMotion>
  )
}
