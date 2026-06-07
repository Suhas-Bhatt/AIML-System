import Link from "next/link";

export function DocLink({
  href,
  children,
}) {
  const isExternal = href.startsWith("http");

  return (
    <Link
      href={href}
      {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="inline-flex items-center gap-0.5 text-mk-terracotta hover:underline underline-offset-2"
    >
      <code className="bg-mk-terracotta/10 px-1.5 py-0.5 rounded text-sm font-mono text-mk-terracotta">
        {children}
      </code>
    </Link>
  );
}
