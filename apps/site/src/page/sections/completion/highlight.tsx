/**
 * The popup's highlight, printed as a pale glaze band behind one row. It is exactly one row tall, so
 * the loop moves it a row with `translateY(-100%)`; `part` names it for the loop that moves it.
 */
export function Highlight({ part }: { part?: string }) {
  return <span data-part={part} className="absolute inset-0 rounded-xs bg-glaze/25" />;
}
