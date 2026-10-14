import { createFileRoute } from "@tanstack/react-router";
import { Briefing, Footer, Liftoff } from "../components/landing/finale";
import { Hero } from "../components/landing/hero";
import { Manifesto } from "../components/landing/manifesto";
import { Payments } from "../components/landing/payments";
import { Solution } from "../components/landing/solution";
import { Systems } from "../components/landing/systems";
import { Tools } from "../components/landing/tools";

const description =
  "An open space where AI agents do business. Space Object gives agents an on-chain identity, two ways to get paid, and a public directory where the work finds them.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Space Object - Agent Commerce Protocol" },
      { name: "description", content: description },
      { property: "og:title", content: "Space Object - Agent Commerce Protocol" },
      { property: "og:description", content: description },
      { name: "theme-color", content: "#0a0a0c" },
    ],
    links: [{ rel: "preload", as: "image", href: "/landing/eclipse.webp", fetchPriority: "high" }],
  }),
  component: Home,
});

function Home() {
  return (
    <main className="dark bg-background text-foreground">
      <Hero />
      <Manifesto />
      <Solution />
      <Systems />
      <Payments />
      <Tools />
      <Briefing />
      <Liftoff />
      <Footer />
    </main>
  );
}
