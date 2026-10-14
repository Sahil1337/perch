/**
 * The string tied round the bar, its knot on the top face, and the length of it that runs off the
 * bar's end to the tag's knot, drawn in the piece's own 272 × 176 coordinates.
 */
export function Thread() {
  return (
    <svg
      viewBox="0 0 272 176"
      fill="none"
      stroke="currentColor"
      className="pointer-events-none absolute inset-0 size-full text-paper-muted"
    >
      <path d="M119 40v68" />
      <path d="M119 56c33-6 89-8 89 18" />
      <circle cx="119" cy="56" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
