/**
 * Skeleton (DailyPlan Day 13 — loading states): a neutral placeholder block
 * shown while server-rendered data loads, via Next.js route `loading.tsx`
 * Suspense boundaries.
 *
 * Pure and hook-free. The pulse animation is gated behind `motion-safe:` so it
 * is stilled for users who prefer reduced motion (Design.md §6); the block is
 * still visible (a static tint), so the loading cue never depends on motion.
 * The wrapping region owns the `role="status"`/`aria-busy` and an sr-only label,
 * so the individual blocks are decorative and hidden from assistive tech.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block rounded-sm bg-border/70 motion-safe:animate-pulse ${className}`}
    />
  );
}
