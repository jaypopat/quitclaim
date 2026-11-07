import { Dithering } from "@paper-design/shaders-react";

export function Landing() {
  return (
    <main className="grid min-h-[calc(100dvh-4rem)] items-center gap-12 px-[clamp(20px,4vw,64px)] md:grid-cols-2">
      <h1 className="text-7xl font-medium tracking-tight">
        Sell a wallet. The seller keeps nothing.
      </h1>
      <Dithering
        className="aspect-square w-full"
        colorBack="#00000000"
        colorFront="#ff5a2a"
        shape="ripple"
        type="4x4"
        size={3}
        speed={0.4}
      />
    </main>
  );
}
