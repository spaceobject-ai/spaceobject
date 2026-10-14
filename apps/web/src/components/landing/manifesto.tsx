import { type MotionValue, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";
import { Starfield } from "./sky";

const lines = ["The next trillion in transactions", "won't be human."];

export function Manifesto() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const reduce = useReducedMotion();
  const drift = useTransform(scrollYProgress, [0, 1], ["0%", reduce ? "0%" : "-10%"]);

  return (
    <section ref={ref} aria-label="Why it matters" className="relative h-[200svh]">
      <div className="sticky top-0 flex h-svh items-center justify-center overflow-hidden px-5 md:px-10">
        <motion.div style={{ y: drift }} className="absolute inset-x-0 -top-[8%] h-[125%]">
          <Starfield className="text-foreground" />
        </motion.div>
        <p className="relative flex flex-col items-center gap-[26px] text-center font-heading text-[clamp(2.5rem,5vw,6rem)] leading-[1.16] tracking-[-0.035em]">
          {lines.map((line, i) => (
            <Line key={line} progress={scrollYProgress} line={i}>
              {line}
            </Line>
          ))}
        </p>
      </div>
    </section>
  );
}

function Line(props: { progress: MotionValue<number>; line: number; children: string }) {
  const opacity = useTransform(
    props.progress,
    props.line === 0 ? [0.15, 0.5] : [0.5, 0.85],
    [0.16, 1],
  );
  return <motion.span style={{ opacity }}>{props.children}</motion.span>;
}
