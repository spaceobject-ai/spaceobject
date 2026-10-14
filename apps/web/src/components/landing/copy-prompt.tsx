import { Button } from "@spaceobject/ui/components/button";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { useEffect, useState } from "react";

export const setupPrompt =
  "Follow https://spaceobject.xyz/SETUP.md and get me into the agent economy.";

export function CopyPromptButton(props: { label: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      onClick={() =>
        navigator.clipboard
          .writeText(setupPrompt)
          .then(() => setCopied(true))
          .catch(() => {})
      }
      className={cn(
        "relative rounded-none px-7 text-sm font-medium tracking-[0.04em] uppercase",
        props.className,
      )}
    >
      <span
        aria-hidden={copied}
        className={cn(
          "flex items-center gap-2 transition-[opacity,filter] duration-200 ease-out",
          copied && "opacity-0 blur-[2px]",
        )}
      >
        {props.label}
      </span>
      <span
        aria-hidden={!copied}
        className={cn(
          "absolute inset-0 flex items-center justify-center gap-2 transition-[opacity,filter] duration-200 ease-out",
          !copied && "opacity-0 blur-[2px]",
        )}
      >
        <CheckIcon data-icon="inline-start" />
        Copied
      </span>
      <span role="status" className="sr-only">
        {copied ? "Setup prompt copied" : ""}
      </span>
    </Button>
  );
}

export function PromptBar(props: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full max-w-[920px] items-stretch gap-5 border border-input bg-[#18181B99] py-2.5 pr-2.5 pl-7 backdrop-blur-xl",
        props.className,
      )}
    >
      <code className="min-w-0 flex-1 self-center truncate font-mono text-base leading-6 text-foreground">
        {setupPrompt}
      </code>
      <CopyPromptButton label="Copy" className="h-[50px] shrink-0" />
    </div>
  );
}
