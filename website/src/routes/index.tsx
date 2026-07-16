import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/LandingPage";
import { getRequestPlatform } from "../lib/platform.functions";

export const Route = createFileRoute("/")({
  loader: () => getRequestPlatform(),
  component: Home,
});

/** Renders the public Navio marketing route. */
function Home() {
  const operatingSystem = Route.useLoaderData();

  return <LandingPage operatingSystem={operatingSystem} />;
}
