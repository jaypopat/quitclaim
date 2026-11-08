import type { ReactNode } from "react";

export function Page({
  title,
  aside,
  children,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex flex-col gap-8 px-[clamp(20px,4vw,64px)] pt-10 pb-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[clamp(32px,4vw,44px)] leading-none font-medium tracking-[-0.03em]">
          {title}
        </h1>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </main>
  );
}
