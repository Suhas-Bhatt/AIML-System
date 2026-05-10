export function trackEvent({ action, category, label, value }) {
  if (typeof window === "undefined") return;
  const gtag = window.gtag;
  if (!gtag) return;
  gtag("event", action, {
    event_category: category,
    event_label: label,
    value,
  });
}

export function trackCtaClick(label, location) {
  trackEvent({
    action: "cta_click",
    category: "conversion",
    label: `${location}__${label}`,
  });
}
