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
    <main className="flex flex-col gap-8 px-[clamp(20px,4vw,64px)] py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl font-medium tracking-tight">{title}</h1>
        {aside && <div className="text-sm text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </main>
  );
}
