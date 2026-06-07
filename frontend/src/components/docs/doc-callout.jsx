import { cn } from '../../lib/utils.js';
import { Info, AlertCircle, CheckCircle2, Lightbulb } from "lucide-react";

const variants = {
  info: {
    bg: "bg-blue-50/50",
    border: "border-blue-200",
    text: "text-blue-900",
    icon: Info,
    iconColor: "text-blue-500",
  },
  warning: {
    bg: "bg-amber-50/50",
    border: "border-amber-200",
    text: "text-amber-900",
    icon: AlertCircle,
    iconColor: "text-amber-500",
  },
  tip: {
    bg: "bg-emerald-50/50",
    border: "border-emerald-200",
    text: "text-emerald-900",
    icon: Lightbulb,
    iconColor: "text-emerald-500",
  },
  success: {
    bg: "bg-emerald-50/50",
    border: "border-emerald-200",
    text: "text-emerald-900",
    icon: CheckCircle2,
    iconColor: "text-emerald-500",
  },
};

export function DocCallout({
  children,
  variant = "info",
  title,
}) {
  const v = variants[variant] || variants.info;
  const Icon = v.icon;

  return (
    <div className={cn("flex gap-3 rounded-lg border p-4 my-5", v.bg, v.border)}>
      <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", v.iconColor)} />
      <div className={cn("text-sm leading-relaxed", v.text)}>
        {title && <p className="font-semibold mb-1">{title}</p>}
        {children}
      </div>
    </div>
  );
}
