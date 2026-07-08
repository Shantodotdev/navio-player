import { HeadContent, Scripts, createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: () => {
    const location = useLocation()
    return (
      <div className="p-8 text-center bg-zinc-950 text-zinc-100 min-h-screen flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-red-400">Route Not Found</h1>
        <p className="mt-2 text-zinc-400">
          The path <code className="bg-zinc-800 px-2 py-1 rounded font-mono text-red-300">{location.pathname}</code> could not be resolved.
        </p>
      </div>
    )
  }
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
