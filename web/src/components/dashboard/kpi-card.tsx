import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  trend?: "up" | "down" | "flat";
  delta?: string;
  className?: string;
}

export function KpiCard({ label, value, unit, hint, trend, delta, className }: KpiCardProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/80 bg-card p-4 shadow-[0_14px_36px_rgba(0,0,0,0.16)] transition-colors hover:border-gold/25",
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
        trend === "up" && "before:bg-success",
        trend === "down" && "before:bg-destructive",
        trend === "flat" && "before:bg-muted-foreground",
        !trend && "before:bg-gold",
        className,
      )}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {delta && (
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums",
              trend === "up" && "text-success",
              trend === "down" && "text-destructive",
              trend === "flat" && "text-muted-foreground",
            )}
          >
            {delta}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold tabular-nums leading-none tracking-tight text-foreground">
          {value}
        </span>
        {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
      </div>
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
