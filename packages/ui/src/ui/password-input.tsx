// A password field with a reveal toggle.
//
// Typing a password blind into a form that then answers "authentication failed" leaves two
// explanations — the wrong password, or a typo in the right one — and no way to tell them apart.
// The eye settles it before the round trip. It starts hidden and reverts on every remount, so
// nothing is revealed that the person did not just ask to see.

import { EyeIcon, EyeOffIcon } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import type { InputProps } from "./input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./input-group";

export function PasswordInput({
  className,
  ...props
}: Omit<InputProps, "className" | "type"> & {
  /** On the group, which is what draws the border — the field inside it is unstyled. */
  className?: string;
}): React.ReactElement {
  const [revealed, setRevealed] = React.useState(false);

  return (
    <InputGroup className={className}>
      <InputGroupInput {...props} type={revealed ? "text" : "password"} />
      <InputGroupAddon align="inline-end">
        <Button
          // The label says what pressing it does, which is the thing a screen reader user needs;
          // `aria-pressed` says which state it is in now.
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
          size="icon-xs"
          variant="ghost"
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}
