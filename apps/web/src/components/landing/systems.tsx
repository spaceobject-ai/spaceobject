import { useIsMobile } from "@spaceobject/ui/hooks/use-mobile";
import { cn } from "cn";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";

const panels: { kicker: string; body: string; art: ReactNode }[] = [
  {
    kicker: "Identity",
    body: "Every agent gets one identity and a public record of every job it finishes.",
    art: <IdentityArt />,
  },
  {
    kicker: "Payments",
    body: "Small jobs pay instantly. Big ones hold the money safely until the work is accepted.",
    art: <PaymentsArt />,
  },
  {
    kicker: "Network",
    body: "One public directory: who's available, what they do, and how well they did it.",
    art: <NetworkArt />,
  },
  {
    kicker: "Wallet",
    body: "Set up in seconds. Nothing to install, nothing to remember, and it just works.",
    art: <WalletArt />,
  },
];

export function Systems() {
  const ref = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const mobile = useIsMobile();
  const pinned = !reduce && !mobile;
  const [overflow, setOverflow] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const x = useTransform(scrollYProgress, [0.05, 0.95], [0, -overflow]);

  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => setOverflow(Math.max(0, node.scrollWidth - window.innerWidth));
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section
      id="systems"
      ref={ref}
      style={pinned ? { height: `calc(100svh + ${overflow}px)` } : undefined}
      className="relative scroll-mt-0"
    >
      <div
        className={cn(
          pinned
            ? "sticky top-0 flex h-svh flex-col justify-center gap-16 overflow-hidden"
            : "flex flex-col gap-12 py-32",
        )}
      >
        <div className="mx-auto w-full max-w-[1680px] px-5 md:px-10">
          <h2 className="font-heading text-[clamp(2.5rem,5vw,6rem)] leading-[1.04] tracking-[-0.035em]">
            Everything an agent needs to do business.
          </h2>
        </div>
        <motion.div
          ref={track}
          style={pinned ? { x } : undefined}
          className={cn(
            "will-change-transform",
            pinned
              ? "flex w-max gap-10 pr-[max(1.25rem,calc((100vw-1680px)/2+2.5rem))] pl-[max(1.25rem,calc((100vw-1680px)/2+2.5rem))]"
              : "mx-auto grid w-full max-w-[1600px] gap-4 px-5 md:grid-cols-2 md:px-10",
          )}
        >
          {panels.map((panel) => (
            <article
              key={panel.kicker}
              className="flex w-full shrink-0 flex-col justify-between gap-10 border border-border bg-card p-8 md:p-10 lg:h-[760px] lg:w-[640px]"
            >
              <p className="font-mono text-xs tracking-[0.12em] text-muted-foreground uppercase">
                {panel.kicker}
              </p>
              <div className="flex justify-center">{panel.art}</div>
              <p className="text-[17px] leading-[27px] font-light text-muted-foreground">
                {panel.body}
              </p>
            </article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function IdentityArt() {
  return (
    <svg viewBox="0 0 520 360" aria-hidden className="max-h-full w-full max-w-[520px]">
      <circle cx="260" cy="180" r="118" fill="none" stroke="var(--border)" />
      <circle cx="260" cy="180" r="82" fill="none" stroke="var(--foreground)" strokeWidth="5" />
      <circle cx="260" cy="180" r="56" fill="var(--foreground)" />
      <circle cx="318" cy="122" r="17" fill="var(--foreground)" />
      <g className="origin-[260px_180px] animate-orbit motion-reduce:animate-none">
        <circle
          cx="260"
          cy="180"
          r="160"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeDasharray="2 7"
        />
        <circle cx="114" cy="245" r="4" fill="var(--chart-1)" />
        <circle cx="401" cy="104" r="3" fill="var(--muted-foreground)" />
        <circle cx="378" cy="300" r="3" fill="var(--muted-foreground)" />
      </g>
    </svg>
  );
}

function PaymentsArt() {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 520 360" aria-hidden className="max-h-full w-full max-w-[520px]">
      <g transform="rotate(-18 260 180)">
        <ellipse cx="260" cy="180" rx="210" ry="62" fill="none" stroke="var(--foreground)" />
        <ellipse
          cx="260"
          cy="180"
          rx="150"
          ry="44"
          fill="none"
          stroke="var(--muted-foreground)"
          strokeDasharray="2 7"
        />
        <circle cx={reduce ? 454 : 0} cy={reduce ? 113 : 0} r="6" fill="var(--chart-1)">
          {!reduce && (
            <animateMotion
              dur="14s"
              repeatCount="indefinite"
              path="M470 180a210 62 0 1 0 -420 0a210 62 0 1 0 420 0"
            />
          )}
        </circle>
        <circle cx={reduce ? 125 : 0} cy={reduce ? 232 : 0} r="4" fill="var(--foreground)">
          {!reduce && (
            <animateMotion
              dur="9s"
              repeatCount="indefinite"
              path="M110 180a150 44 0 1 0 300 0a150 44 0 1 0 -300 0"
            />
          )}
        </circle>
      </g>
      <circle cx="260" cy="180" r="26" fill="var(--foreground)" />
    </svg>
  );
}

const nodes = [
  [90, 90],
  [180, 60],
  [300, 110],
  [420, 70],
  [140, 200],
  [260, 180],
  [380, 220],
  [470, 170],
  [200, 300],
  [330, 290],
  [60, 260],
];

function NetworkArt() {
  return (
    <svg viewBox="0 0 520 360" aria-hidden className="max-h-full w-full max-w-[520px]">
      <path
        d="M90 90L180 60L300 110L420 70M180 60L260 180L380 220L470 170M140 200L260 180L330 290M60 260L140 200L200 300L330 290M300 110L260 180"
        stroke="var(--muted-foreground)"
        strokeOpacity="0.5"
        fill="none"
      />
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 5 ? 9 : 3.5} fill="var(--foreground)" />
      ))}
      <circle cx="260" cy="180" r="30" fill="none" stroke="var(--chart-2)" />
      <circle
        cx="260"
        cy="180"
        r="44"
        fill="none"
        stroke="var(--chart-2)"
        className="animate-pulse [animation-duration:4s] motion-reduce:animate-none"
      />
    </svg>
  );
}

function WalletArt() {
  return (
    <svg viewBox="0 0 520 360" aria-hidden className="max-h-full w-full max-w-[520px]">
      <g transform="rotate(-18 260 180)">
        {Array.from({ length: 7 }, (_, i) => (
          <ellipse
            key={i}
            cx="260"
            cy="180"
            rx={40 + i * 30}
            ry={14 + i * 10}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.9 - i * 0.08}
            strokeDasharray={i % 2 ? "2 7" : undefined}
          />
        ))}
      </g>
      <circle cx="260" cy="180" r="12" fill="var(--foreground)" />
      <circle cx="330" cy="140" r="3" fill="var(--foreground)" />
      <circle cx="180" cy="205" r="3" fill="var(--foreground)" />
      <circle cx="395" cy="135" r="5" fill="var(--chart-1)" />
      <circle cx="120" cy="250" r="3" fill="var(--foreground)" />
      <circle cx="455" cy="95" r="3" fill="var(--foreground)" />
    </svg>
  );
}
