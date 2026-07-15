import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "../components/LandingPage";

export const Route = createFileRoute("/")({ component: Home });

/** Renders the public Navio marketing route. */
function Home() {
  return <LandingPage />;
}
