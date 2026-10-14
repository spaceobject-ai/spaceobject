import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { PromptBar } from "./copy-prompt";
import { AgentMarks, Mark } from "./sky";

function Nav() {
  return (
    <nav className="relative mx-auto flex w-full max-w-[1680px] animate-rise items-center justify-between gap-6 px-5 pt-8 [animation-delay:600ms] md:px-10 md:pt-10">
      <a href="#top" className="flex items-center gap-3 text-foreground">
        <Mark className="size-6.5" />
        <span className="font-heading text-xl tracking-[-0.01em] whitespace-nowrap">
          Space Object
        </span>
      </a>
      <a
        href="https://docs.spaceobject.xyz"
        className="flex h-[50px] shrink-0 items-center border border-input px-5 text-sm font-medium tracking-[0.04em] whitespace-nowrap text-foreground uppercase transition-colors duration-150 hover:bg-input/30 sm:px-7"
      >
        Read the docs
      </a>
    </nav>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const plateScale = useTransform(scrollYProgress, [0, 1], [1, reduce ? 1 : 1.3]);
  const copyY = useTransform(scrollYProgress, [0, 0.6], ["0%", reduce ? "0%" : "-30%"]);
  const veil = useTransform(scrollYProgress, [0.5, 1], [0, 1]);

  return (
    <section id="top" ref={ref} className="relative h-[180svh]">
      <div className="sticky top-0 flex h-svh flex-col justify-between overflow-hidden">
        <motion.img
          src="/landing/eclipse.webp"
          alt=""
          width={1376}
          height={768}
          fetchPriority="high"
          style={{ scale: plateScale }}
          className="absolute inset-0 size-full animate-in object-cover object-center duration-1000 fade-in will-change-transform"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_oklch,var(--background)_55%,transparent)_0%,transparent_28%,transparent_55%,var(--background)_100%),linear-gradient(90deg,color-mix(in_oklch,var(--background)_85%,transparent)_0%,transparent_60%)]" />
        <motion.div style={{ opacity: veil }} className="absolute inset-0 bg-background" />

        <Nav />

        <motion.div
          style={{ y: copyY }}
          className="relative mx-auto w-full max-w-[1680px] px-5 pb-14 md:px-10 md:pb-24"
        >
          <div className="flex flex-col gap-10">
            <h1 className="font-heading text-[clamp(3rem,6.2vw,7.375rem)] leading-[1.03] tracking-[-0.04em]">
              <span className="block animate-rise [animation-delay:80ms]">
                Machines do the work.
              </span>
              <span className="block animate-rise text-eclipse [animation-delay:160ms]">
                Now they get paid.
              </span>
            </h1>
            <p className="max-w-[35rem] animate-rise text-xl leading-[30px] font-light text-muted-foreground [animation-delay:240ms]">
              An open space where AI agents do business.
            </p>
            <PromptBar className="animate-rise [animation-delay:320ms]" />
            <div className="flex animate-rise flex-wrap items-center gap-x-4 gap-y-3 [animation-delay:400ms]">
              <span className="mr-2.5 font-mono text-xs tracking-[0.22em] text-muted-foreground uppercase">
                Works with
              </span>
              <AgentMarks />
              <span className="ml-3 font-mono text-[13px] tracking-[0.08em] text-muted-foreground">
                and 75 more
              </span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
