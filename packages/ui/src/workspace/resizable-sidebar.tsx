import * as React from "react";
import { cn } from "../lib/utils";

const KEYBOARD_STEP = 16;

/**
 * The left sidebar and its drag handle. The range is wide in both directions — a deep schema path
 * needs room, a bare file list does not — and the width is persisted by the caller.
 *
 * The handle is a real `separator` with arrow-key support, not a decorative strip: resizing a pane
 * is exactly the kind of thing that silently becomes mouse-only.
 */
export function ResizableSidebar({
  width,
  onWidthChange,
  open,
  min = 180,
  max = 600,
  defaultWidth = 256,
  label = "Sidebar",
  children,
  className,
}: {
  width: number;
  onWidthChange: (width: number) => void;
  open: boolean;
  min?: number;
  max?: number;
  /** Restored on double-click, the conventional "put it back" gesture. */
  defaultWidth?: number;
  label?: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const asideRef = React.useRef<HTMLElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const clamp = React.useCallback(
    (value: number) => Math.min(max, Math.max(min, Math.round(value))),
    [max, min],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // Let the browser handle anything that is not a primary-button drag.
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    const left = asideRef.current?.getBoundingClientRect().left ?? 0;
    onWidthChange(clamp(event.clientX - left));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const delta =
      event.key === "ArrowLeft" ? -KEYBOARD_STEP : event.key === "ArrowRight" ? KEYBOARD_STEP : 0;
    if (delta === 0) return;
    event.preventDefault();
    onWidthChange(clamp(width + delta));
  };

  return (
    <>
      <aside
        aria-hidden={!open}
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden bg-sidebar",
          // Collapsing animates; dragging must not, or the pane lags behind the pointer.
          // `transition-width` comes from styles.css; the linter cannot see this package's CSS.
          // eslint-disable-next-line shadcn/no-unknown-classes
          !dragging && "transition-width duration-150 ease-out",
          open ? "w-(--sidebar-w)" : "w-0",
          className,
        )}
        data-state={open ? "open" : "collapsed"}
        ref={asideRef}
        // A width the user drags to cannot be a class; as a custom property, only the number is inline.
        style={{ "--sidebar-w": `${width}px` } as React.CSSProperties}
      >
        {/* Holds its width while the pane collapses, so the content slides rather than reflowing. */}
        <div className="flex h-full w-(--sidebar-w) min-w-0 flex-col">{children}</div>
      </aside>

      {open && (
        <div
          aria-label={`Resize ${label.toLowerCase()}`}
          aria-orientation="vertical"
          aria-valuemax={max}
          aria-valuemin={min}
          aria-valuenow={width}
          className={cn(
            // 4px of grab area around a 1px mark; the negative margin keeps it out of the layout.
            "-ml-px w-1 shrink-0 cursor-col-resize border-border border-l outline-none",
            "hover:border-ring/60 focus-visible:border-ring",
            dragging && "border-ring",
          )}
          onDoubleClick={() => onWidthChange(defaultWidth)}
          onKeyDown={onKeyDown}
          onLostPointerCapture={endDrag}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          role="separator"
          tabIndex={0}
        />
      )}
    </>
  );
}
