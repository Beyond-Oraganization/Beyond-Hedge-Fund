import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, type ReactNode } from 'react'
import { createHashRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from './api/bot.ts'
import { Shell } from './app/Shell.tsx'
import { Skeleton } from './components/ui.tsx'
import { Crashed, NotFound } from './screens/NotFound.tsx'

const Session = lazy(() => import('./screens/Session.tsx'))
const Trading = lazy(() => import('./screens/Trading.tsx'))
const Markets = lazy(() => import('./screens/Markets.tsx'))
const MarketDetail = lazy(() => import('./screens/MarketDetail.tsx'))
const Backtest = lazy(() => import('./screens/Backtest.tsx'))
const Orders = lazy(() => import('./screens/Orders.tsx'))
const Strategies = lazy(() => import('./screens/Strategies.tsx'))
const Console = lazy(() => import('./screens/Console.tsx'))
const System = lazy(() => import('./screens/System.tsx'))
const Settings = lazy(() => import('./screens/Settings.tsx'))
const Account = lazy(() => import('./screens/Account.tsx'))
const Connect = lazy(() => import('./screens/Connect.tsx'))
const Connections = lazy(() => import('./screens/Connections.tsx'))
const Install = lazy(() => import('./screens/Install.tsx'))
const SignIn = lazy(() => import('./screens/SignIn.tsx'))
const Me = lazy(() => import('./screens/Me.tsx'))
// The design kit's page: development builds only; a production build has neither the route nor its chunk.
const DesignPage = import.meta.env.DEV ? lazy(() => import('./shared/ui/DesignPage.tsx')) : null

const page = (node: ReactNode) => (
  <Suspense
    fallback={
      <section className="sec" aria-busy="true">
        <div className="wrap">
          <Skeleton lines={4} />
        </div>
      </section>
    }
  >
    {node}
  </Suspense>
)

/** Hash routes: GitHub Pages cannot rewrite deep links inside the app's folder. */
const router = createHashRouter([
  {
    element: <Shell />,
    errorElement: <Crashed />,
    children: [
      { index: true, element: page(<Session />) },
      { path: 'trading', element: page(<Trading />) },
      { path: 'markets', element: page(<Markets />) },
      { path: 'markets/:symbol/:interval', element: page(<MarketDetail />) },
      { path: 'backtest', element: page(<Backtest />) },
      { path: 'orders', element: page(<Orders />) },
      { path: 'strategies', element: page(<Strategies />) },
      { path: 'console', element: page(<Console />) },
      { path: 'system', element: page(<System />) },
      { path: 'settings', element: page(<Settings />) },
      { path: 'account', element: page(<Account />) },
      { path: 'connect', element: page(<Connect />) },
      { path: 'connections', element: page(<Connections />) },
      { path: 'install', element: page(<Install />) },
      { path: 'signin', element: page(<SignIn />) },
      { path: 'me', element: page(<Me />) },
      ...(DesignPage ? [{ path: 'design', element: page(<DesignPage />) }] : []),
      { path: '*', element: <NotFound /> },
    ],
  },
])

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
