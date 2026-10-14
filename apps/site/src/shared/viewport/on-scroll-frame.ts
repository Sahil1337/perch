export type ScrollFrame = {
  /** Asks for `update` on the next frame, unless one is already asked for. */
  schedule: () => void;
  stop: () => void;
};

/**
 * Runs `update` now, then at most once a frame while the page scrolls and, unless `resize` is
 * false, resizes.
 */
export function onScrollFrame(update: () => void, { resize = true } = {}): ScrollFrame {
  let frame = 0;
  const run = () => {
    frame = 0;
    update();
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(run);
  };
  update();
  addEventListener("scroll", schedule, { passive: true });
  if (resize) addEventListener("resize", schedule);
  return {
    schedule,
    stop() {
      removeEventListener("scroll", schedule);
      if (resize) removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    },
  };
}
