import { useEffect } from 'react'
import { Outlet, useLocation, useMatch } from 'react-router-dom'
import { Scene } from '../scene/Scene'
import { FilmGrain } from './FilmGrain'
import { Footer } from './Footer'

/** Persistent scene behind every route; page content and footer sit above it. */
export function Layout() {
  // While a ritual is under way the camera eases down about 60 px.
  const ritual = useMatch('/r/:id') !== null
  const { pathname } = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      <Scene descended={ritual} />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <main id="main" className="flex flex-1 flex-col">
          <Outlet />
        </main>
        <Footer />
      </div>
      <FilmGrain />
    </>
  )
}
