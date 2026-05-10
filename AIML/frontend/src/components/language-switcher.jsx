"use client";

import { useAppLocale } from '../components/app-locale-provider.jsx';
import { cn } from '../lib/utils.js';

export function LanguageSwitcher({ compact = false }) {
  const { locale, setLocale, t } = useAppLocale();

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border bg-background p-1",
        compact && "scale-95",
      )}
    >
      {["en", "zh"].map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setLocale(option)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            locale === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option === "en" ? t("common.english") : t("common.chinese")}
        </button>
      ))}
    </div>
  );
}
