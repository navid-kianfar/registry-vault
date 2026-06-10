interface BrandMarkProps {
  className?: string;
}

/**
 * Registry Vault brand mark — push/pull arrows around a package.
 * Inherits the main color from `currentColor`; the push arrow stays brand
 * blue, and the package edges use the surrounding tile color (`--primary`)
 * so the mark works inside `bg-primary text-primary-foreground` tiles in
 * both light and dark mode.
 */
export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path d="M14 16 H43" stroke="#3b82f6" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M38 9 L46 16 L38 23"
        stroke="#3b82f6"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M50 48 H21" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path
        d="M26 41 L18 48 L26 55"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M32 24.5 L39 28 V36 L32 39.5 L25 36 V28 Z" fill="currentColor" />
      <path
        d="M25 28 L32 31.5 L39 28 M32 31.5 V39.5"
        stroke="hsl(var(--primary))"
        strokeWidth="1.8"
      />
    </svg>
  );
}
