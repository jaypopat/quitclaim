import type { TitleCheck } from "@quitclaim/shared/derive.ts";
import { Check, Minus, X } from "lucide-react";

const ICONS = {
  pass: <Check className="size-4 text-foreground" />,
  warn: <Minus className="size-4 text-primary" />,
  fail: <X className="size-4 text-destructive" />,
};

export function TitleChecks({
  checks,
  title = "Title check",
}: {
  checks: TitleCheck[];
  title?: string;
}) {
  const passed = checks.filter((c) => c.status === "pass").length;
  return (
    <section className="flex flex-col">
      <header className="flex items-baseline justify-between border-b pb-3">
        <h2 className="text-lg font-medium">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {passed}/{checks.length}
        </span>
      </header>
      <ul>
        {checks.map((check) => (
          <li key={check.label} className="flex gap-3 border-b py-3">
            <span className="mt-0.5">{ICONS[check.status]}</span>
            <span className="flex flex-col gap-1">
              <span className="text-sm font-medium">{check.label}</span>
              <span className="text-xs text-muted-foreground">
                {check.plain}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
