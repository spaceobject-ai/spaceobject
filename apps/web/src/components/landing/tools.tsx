import { PoweredBy } from "./sky";

const providers = [
  { name: "Apollo", tag: "sales intel", logo: "/landing/tools/apollo.svg" },
  { name: "Seedance 2.5", tag: "video gen", logo: "/landing/tools/seedance.png" },
  { name: "TinyFish", tag: "search + page fetch", logo: "/landing/tools/tinyfish.png" },
  { name: "Ahrefs", tag: "SEO data", logo: "/landing/tools/ahrefs.png" },
  { name: "Exa", tag: "web search", logo: "/landing/tools/exa.png" },
  { name: "Reddit", tag: "scraping", logo: "/landing/tools/reddit.svg" },
  { name: "TikTok", tag: "scraping", logo: "/landing/tools/tiktok.svg" },
  { name: "Instagram", tag: "scraping", logo: "/landing/tools/instagram.svg" },
  { name: "YouTube", tag: "scraping", logo: "/landing/tools/youtube.svg" },
  { name: "Amazon", tag: "scraping", logo: "/landing/tools/amazon.svg" },
  { name: "Browserbase", tag: "web automation", logo: "/landing/tools/browserbase.png" },
  { name: "Firecrawl", tag: "web scraping", logo: "/landing/tools/firecrawl.svg" },
  { name: "DeFiLlama", tag: "protocol fundamentals", logo: "/landing/tools/defillama.svg" },
  { name: "AgentMail", tag: "agent email", logo: "/landing/tools/agentmail.png" },
  { name: "ElevenLabs", tag: "AI voice", logo: "/landing/tools/elevenlabs.jpg" },
  { name: "Google Reviews", tag: "scraping", logo: "/landing/tools/google-reviews.png" },
  { name: "Telegram", tag: "scraping", logo: "/landing/tools/telegram.svg" },
  { name: "MiniMax", tag: "AI media gen", logo: "/landing/tools/minimax.png" },
  { name: "People Data Labs", tag: "people search", logo: "/landing/tools/people-data-labs.png" },
];

export function Tools() {
  return (
    <section
      id="tools"
      className="flex w-full flex-col items-center gap-20 px-5 py-32 md:px-10 md:py-40"
    >
      <div className="flex flex-col items-center gap-[18px]">
        <p className="font-mono text-xs tracking-[0.28em] text-eclipse uppercase">Access</p>
        <h2 className="flex flex-col items-center text-center font-heading text-[clamp(3rem,4.3vw,5.125rem)] leading-[1.07] tracking-[-0.04em]">
          <span>2,100+ tools.</span>
          <span className="text-eclipse">75+ providers.</span>
        </h2>
      </div>

      <ul
        aria-label="Some of the providers"
        className="grid w-full max-w-[1600px] grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5"
      >
        {providers.map((provider) => (
          <li
            key={provider.name}
            className="flex items-center gap-4 border border-border bg-card p-6.5"
          >
            <span className="flex size-10 shrink-0 items-center justify-center bg-[#F4F3EF]">
              <img src={provider.logo} alt="" className="size-[26px] object-contain" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-sans text-[17px] leading-5 text-foreground">
                {provider.name}
              </span>
              <span className="truncate font-mono text-xs leading-[15px] tracking-[0.04em] text-muted-foreground">
                {provider.tag}
              </span>
            </span>
          </li>
        ))}
        <li className="flex items-center gap-4 border border-border bg-card p-6.5">
          <span className="flex size-10 shrink-0 items-center justify-center bg-[#F4F3EF]">
            <svg viewBox="0 0 26 26" aria-hidden className="size-6.5">
              <path
                d="M13 5.5V20.5M5.5 13H20.5"
                fill="none"
                stroke="var(--eclipse)"
                strokeWidth="2"
                strokeLinecap="square"
              />
            </svg>
          </span>
          <span className="font-sans text-[17px] leading-5 text-foreground">and more</span>
        </li>
      </ul>

      <PoweredBy />
    </section>
  );
}
