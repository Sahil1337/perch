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
import {
  SETTINGS_EVENT,
  SettingsDialog,
  type SettingsPane,
} from "./settings-dialog";

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
  const [pane, setPane] = React.useState<SettingsPane>("editor");

  useHotkey({ key: ",", mod: true }, () => setOpen(true));

  // Both halves of the request land here, because both are this component's state: the gear owns
  // the dialog, and which pane it opens on is the same kind of answer as whether it is open.
  React.useEffect(() => {
    const listener = (event: Event): void => {
      const target = (event as CustomEvent<{ pane?: SettingsPane }>).detail?.pane;
      if (target) setPane(target);
      setOpen(true);
    };
    window.addEventListener(SETTINGS_EVENT, listener);
    return () => window.removeEventListener(SETTINGS_EVENT, listener);
  }, []);

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

      <SettingsDialog
        onOpenChange={setOpen}
        onPaneChange={setPane}
        open={open}
        pane={pane}
      />
    </>
  );
}
