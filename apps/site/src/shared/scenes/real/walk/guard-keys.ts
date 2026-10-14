const walkWindows = new Set<Element>();
let keysGuarded = false;

/**
 * The Query Walk binds Space and the arrow keys on `window`, in the capture phase, for as long as
 * it is mounted — right for a modal dialog, wrong on a page, where Space scrolls. A press whose
 * target is outside every walk window is made to look like Alt+key to the walk's listener, the one
 * modifier it ignores, and is put back before the event goes any further than `window`.
 *
 * It has to be registered before the walk's own listener, which is why it is installed by the
 * light scene module rather than by the walk; listeners on one target run in the order they were
 * added. Returns the function that registers a walk window as a place where the keys are the walk's.
 */
export function guardWalkKeys(): (element: Element) => () => void {
  if (!keysGuarded && typeof window !== "undefined") {
    keysGuarded = true;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== " " && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const target = event.target instanceof Node ? event.target : null;
        for (const element of walkWindows) if (target && element.contains(target)) return;
        Object.defineProperty(event, "altKey", { configurable: true, value: true });
      },
      true,
    );
    document.addEventListener(
      "keydown",
      (event) => {
        if (Object.hasOwn(event, "altKey")) Reflect.deleteProperty(event, "altKey");
      },
      true,
    );
  }
  return (element) => {
    walkWindows.add(element);
    return () => walkWindows.delete(element);
  };
}
