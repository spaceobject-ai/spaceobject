import { cn } from "cn";

const Arrow = () => (
  <svg viewBox="0 0 18 18" aria-hidden className="size-[18px] shrink-0">
    <path d="M3 9 H13.5 M9.5 4.5 L14 9 L9.5 13.5" fill="none" stroke="var(--muted-foreground)" />
  </svg>
);

const rails = [
  {
    title: "Direct",
    body: "One quick task, paid the second it happens. No sign-up, no invoice, no waiting.",
    steps: ["Ask", "Pay", "Done"],
  },
  {
    title: "Escrow",
    body: "The money is set aside before work starts, and only handed over once the job is accepted.",
    steps: ["Agree", "Work", "Accepted", "Paid"],
  },
];

export function Payments() {
  return (
    <section id="payments" aria-label="Getting paid" className="relative overflow-hidden">
      <img
        src="/landing/comets.webp"
        alt=""
        width={1376}
        height={768}
        loading="lazy"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--background)_0%,transparent_9.3%,transparent_81.5%,var(--background)_100%)]" />

      <div className="relative mx-auto flex w-full max-w-[1680px] flex-col gap-20 px-5 py-32 md:px-10 md:py-40 lg:gap-44">
        <h2 className="font-heading text-[clamp(2.25rem,3.6vw,4.125rem)] leading-[1.12] tracking-[-0.035em]">
          Money, at the right speed.
        </h2>

        <div className="grid gap-10 lg:grid-cols-2">
          {rails.map((rail) => (
            <article
              key={rail.title}
              className="flex flex-col gap-[30px] border border-border bg-card p-8 md:p-12"
            >
              <h3 className="font-heading text-[clamp(2rem,2.6vw,2.875rem)] leading-[1.13] tracking-[-0.02em]">
                {rail.title}
              </h3>
              <p className="max-w-[600px] text-[17px] leading-[27px] font-light text-muted-foreground">
                {rail.body}
              </p>
              <ol className="mt-auto flex flex-wrap items-center gap-3.5">
                {rail.steps.map((step, i) => {
                  const done = i === rail.steps.length - 1;
                  return (
                    <li key={step} className="flex items-center gap-3.5">
                      {i > 0 && <Arrow />}
                      <span
                        className={cn(
                          "border px-[18px] py-3 font-mono text-[13px] leading-4 tracking-[0.16em] uppercase",
                          done
                            ? "border-eclipse bg-eclipse/14 text-eclipse"
                            : "border-input text-foreground",
                        )}
                      >
                        {step}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
