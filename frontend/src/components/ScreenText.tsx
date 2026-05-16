import { forwardRef } from "react";
import { ScreenCopy } from "@/lib/cinematic";

export const ScreenText = forwardRef<HTMLDivElement, { copy: ScreenCopy }>(
  function ScreenText({ copy }, ref) {
    const right = copy.side === "right";
    return (
      <div
        ref={ref}
        className="pointer-events-none absolute top-1/2 z-20 -translate-y-1/2"
        style={{
          width: "56%",
          maxWidth: 540,
          opacity: 0,
          willChange: "opacity, transform",
          ...(right ? { right: 48 } : { left: 48 }),
          textAlign: right ? "right" : "left",
        }}
      >
        {copy.eyebrow && (
          <p
            className="mb-3 text-xs font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--color-accent)" }}
          >
            {copy.eyebrow}
          </p>
        )}
        <h2
          className="mb-3 font-extrabold leading-tight text-white"
          style={{
            fontSize: "clamp(1.75rem,3.6vw,2.75rem)",
            textShadow: "0 2px 10px rgba(0,0,0,0.85)",
            letterSpacing: "-0.02em",
          }}
        >
          {copy.headline}
        </h2>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "#d6d6dc", textShadow: "0 1px 6px rgba(0,0,0,0.85)" }}
        >
          {copy.subtext}
        </p>
      </div>
    );
  },
);
