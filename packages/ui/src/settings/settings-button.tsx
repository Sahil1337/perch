// The gear.
//
// Owns the dialog it opens, so a caller mounts one element and gets both — the alternative is
// every surface that wants a settings button also holding a piece of settings state, and two of
// them eventually holding it at once. ⌘, is bound here for the same reason: the shortcut and the
// button are the same control, and binding it anywhere else would let them drift apart.

import { SettingsIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useHotkey } from "../workspace/use-hotkey";
import { SettingsDialog } from "./settings-dialog";

export type SettingsButtonProps = {
  /** Matches the surrounding bar; the topbar uses "icon-sm". */
  size?: "icon-xs" | "icon-sm" | "icon";
  className?: string;
};

export function SettingsButton({
  size = "icon-sm",
  className,
}: SettingsButtonProps): React.ReactElement {
  const [open, setOpen] = React.useState(false);

  useHotkey({ key: ",", mod: true }, () => setOpen(true));

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Settings"
              className={className}
              onClick={() => setOpen(true)}
              size={size}
              variant="ghost"
            />
          }
        >
          <SettingsIcon />
        </TooltipTrigger>
        <TooltipPopup>Settings ⌘,</TooltipPopup>
      </Tooltip>

      <SettingsDialog onOpenChange={setOpen} open={open} />
    </>
  );
}
