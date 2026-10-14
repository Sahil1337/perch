import type { Ref } from "react";
import { Keycap } from "../../materials";
import { CopiedSlip } from "./return-key/copied-slip";
import { ReturnLegend } from "./return-key/return-legend";
import { usePress } from "./return-key/use-press";

export type ReturnKeyProps = {
  /** The bird's last perch: the key's top face. */
  perchRef: Ref<HTMLElement>;
  /** The command was just copied: the slip shows. */
  copied: boolean;
  /** Copies the install command. */
  onPress: () => void;
};

/**
 * A porcelain return key at the end of the install command, as at the end of a typed line: a real
 * button that sits down while it is held and copies the command when pressed.
 */
export function ReturnKey({ perchRef, copied, onPress }: ReturnKeyProps) {
  const { pressed, handlers } = usePress();
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        aria-label="Copy the install command"
        onClick={onPress}
        {...handlers}
        className="flex cursor-pointer touch-manipulation rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Keycap
          size="lg"
          pressed={pressed}
          topRef={perchRef}
          faceClassName="h-11 w-18 items-end justify-start px-2 pb-2 text-xs lg:h-14 lg:w-28 lg:px-3 lg:pb-2.5 lg:text-sm"
        >
          <ReturnLegend />
        </Keycap>
      </button>
      <CopiedSlip shown={copied} />
    </span>
  );
}
