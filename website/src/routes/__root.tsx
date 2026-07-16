import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Navio — Your media, finally in one place",
      },
      {
        name: "description",
        content:
          "Navio is a private, local-first desktop player for your music, videos, playlists, and downloads.",
      },
      {
        name: "theme-color",
        content: "#050507",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/png",
        href: "/navio-logo.png",
      },
    ],
  }),
  shellComponent: RootDocument,
});

/** Defines the shared HTML document and metadata shell. */
function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html className="min-w-80 scroll-smooth bg-[#050507]" lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="m-0 min-h-screen overflow-x-hidden bg-[radial-gradient(circle_at_50%_-10%,rgba(143,21,50,0.14),transparent_34rem)] bg-[#050507] font-['Inter_Variable'] font-medium text-[#f5f3f4] antialiased scheme-dark">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
