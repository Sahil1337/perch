// A figure blank in a place above its own digits, as a printed count is: 6, never 06.
const BLANK = "\u00a0";

function digitAt(value: number, place: number): number | null {
  const power = 10 ** place;
  return place > 0 && value < power ? null : Math.floor(value / power) % 10;
}

/** The figures a place shows on its way from one count to the next, one digit at a time. */
function wheel(from: number, to: number, place: number): string[] {
  const first = digitAt(from, place);
  const last = digitAt(to, place);
  const start = first ?? 0;
  const end = last ?? 0;
  const step = end >= start ? 1 : -1;
  const figures: string[] = [];
  for (let digit = start; digit !== end + step; digit += step) {
    const blank = (digit === start && first === null) || (digit === end && last === null);
    figures.push(blank ? BLANK : String(digit));
  }
  return figures;
}

/**
 * A count printed as a little odometer: each place is a window one line tall over a column of the
 * figures it passes on the way from `from` to `to`. The column stands on the window's foot, so the
 * window shows `to` and the rest are clipped above it; the loop rolls the column up through the
 * window with a transform alone, so the count ticks with no state at all.
 */
export function RollingCount({ from, to, places }: { from: number; to: number; places: number }) {
  return (
    <span className="flex tabular-nums">
      {Array.from({ length: places }, (_, i) => places - 1 - i).map((place) => (
        <span key={place} className="flex h-lh flex-col justify-end overflow-hidden">
          <span data-wheel="" className="flex flex-col">
            {wheel(from, to, place).map((figure, i) => (
              <span key={i}>{figure}</span>
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}
