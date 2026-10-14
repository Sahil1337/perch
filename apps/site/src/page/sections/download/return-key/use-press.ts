import { type KeyboardEvent, type PointerEvent, useState } from "react";

const PRESS_KEYS = new Set(["Enter", " "]);

/**
 * Whether a button is being held down, by pointer or by Enter/Space, so a key drawn on it can sit
 * down while it is held and come back up when it is let go, as a real key does.
 */
export function usePress() {
  const [held, setHeld] = useState(false);
  const release = () => setHeld(false);
  return {
    pressed: held,
    handlers: {
      onPointerDown: (event: PointerEvent) => {
        if (event.button === 0) setHeld(true);
      },
      onPointerUp: release,
      onPointerLeave: release,
      onPointerCancel: release,
      onKeyDown: (event: KeyboardEvent) => {
        if (PRESS_KEYS.has(event.key)) setHeld(true);
      },
      onKeyUp: (event: KeyboardEvent) => {
        if (PRESS_KEYS.has(event.key)) setHeld(false);
      },
      onBlur: release,
    },
  };
}
