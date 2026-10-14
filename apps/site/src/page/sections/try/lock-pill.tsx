import { AnimatePresence, motion, useAnimate } from "motion/react";
import { useEffect, useImperativeHandle, useState, type Ref } from "react";
import { EASE_OUT } from "../../../shared/motion";

// How long "Your turn" stays on the window once the editor is the visitor's.
const HANDED_NOTICE_MS = 4500;

/** What the window can ask of its pill: a nudge when the visitor reaches for the editor too soon. */
export type LockPillHandle = { nudge: () => void };

/**
 * Sits on the window's top edge and says whose the editor is: the demo's, with a way to skip to the
 * end of it, and then, for a few seconds, the visitor's. Its text is a `p`, which the bird keeps off.
 */
export function LockPill({ ref, live, onSkip }: { ref?: Ref<LockPillHandle>; live: boolean; onSkip: () => void }) {
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const [noticeShown, setNoticeShown] = useState(true);

  useImperativeHandle(ref, () => ({
    nudge: () => {
      if (!scope.current) return;
      void animate(scope.current, { x: [0, -6, 5, -3, 0], scale: [1, 1.04, 1] }, { duration: 0.45, ease: EASE_OUT });
    },
  }));

  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => setNoticeShown(false), HANDED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [live]);

  const shown = !live || noticeShown;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex -translate-y-1/2 justify-center">
      <AnimatePresence mode="wait">
        {shown ? (
          <motion.div
            key={live ? "yours" : "demo"}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          >
            <div
              ref={scope}
              role="status"
              data-try-pill=""
              className="pointer-events-auto flex h-8 items-center gap-2.5 rounded-full bg-porcelain pr-1 pl-3.5 text-paper-ink text-sm shadow-(--bui-shadow-overlay)"
            >
              {live ? (
                <p className="pr-2.5">Your turn — edit anything, ⌘↵ to run</p>
              ) : (
                <>
                  <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-glaze" />
                  <p>Demo playing · yours in a moment</p>
                  <button
                    type="button"
                    onClick={onSkip}
                    className="h-6 rounded-full bg-paper-ink px-2.5 font-medium text-porcelain text-sm transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-glaze focus-visible:outline-offset-2"
                  >
                    Skip
                  </button>
                </>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
