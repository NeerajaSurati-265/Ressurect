import { useEffect } from 'react'
import { Outlet, useLocation, useMatch } from 'react-router-dom'
import { Scene } from '../scene/Scene'
import { FilmGrain } from './FilmGrain'
import { Footer } from './Footer'
import { ParticleLayer } from '../fx/ParticleLayer'
import { FogWipe } from './misc/FogWipe'
import { KeeperLayer } from '../keeper/Keeper'

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
      {/* the Keeper travels above the scene and content, below fog wipe, particles and grain */}
      <KeeperLayer />
      <div className="relative z-10 flex min-h-dvh flex-col">
        <main id="main" className="flex flex-1 flex-col">
          <Outlet />
        </main>
        <Footer />
      </div>
      <FogWipe trigger={ritual ? 'ritual' : pathname === '/' ? 'landing' : 'other'} />
      <ParticleLayer />
      <FilmGrain />
    </>
  )
}
