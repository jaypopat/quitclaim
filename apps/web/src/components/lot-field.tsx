import type { ComponentProps } from "react";
import { Dithering } from "@paper-design/shaders-react";
import type { Offer } from "@quitclaim/shared/derive.ts";
import { useDitherColors, type Rgba } from "@/lib/dither";
import { usePrefersReducedMotion } from "@/lib/dither/motion";
import { cn } from "@/lib/utils";

type Shape = ComponentProps<typeof Dithering>["shape"];

/** A lot's field reads its offer at a glance: rings for sale, a swirl on offer, a warp while leased. */
const SHAPES: Record<Offer["kind"], Shape> = {
  sale: "ripple",
  "lease-offer": "swirl",
  leased: "warp",
  none: "simplex",
};

const css = ([r, g, b, a]: Rgba) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;

export function LotField({
  id,
  offer,
  size = 3,
  className,
}: {
  id: number;
  offer: Offer["kind"];
  size?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const colors = useDitherColors(undefined, ["ink", "--card"]);
  return (
    <div className={cn("bg-card", className)} aria-hidden>
      {colors && (
        <Dithering
          className="size-full"
          colorFront={css(colors[0])}
          colorBack={css(colors[1])}
          shape={SHAPES[offer]}
          type="4x4"
          size={size}
          speed={reduced ? 0 : 0.25}
          scale={0.7 + (id % 5) * 0.1}
          rotation={(id * 67) % 360}
          offsetX={((id * 37) % 40) / 100 - 0.2}
        />
      )}
    </div>
  );
}
