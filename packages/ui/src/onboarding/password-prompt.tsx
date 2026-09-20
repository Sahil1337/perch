// The answer to the commonest reason a database refuses a connection.
//
// A server on a default port, in a container, or behind any auth method other than trust says
// "password" and nothing else. That is not a reason to throw away everything discovery worked
// out and hand back an empty seven-field form — the address is right, the login is right, one
// thing is missing. So the row that failed grows the one field, and keeps its place in the list.

import { KeyRoundIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

/**
 * A server that answered and asked for a password. It is not an error state: nothing is wrong yet,
 * the server has simply said what it needs, so the row grows a field rather than the screen
 * growing a red box and seven of them.
 */
export type PasswordChallenge = {
  /** The `serverKey` of the discovered row, or the id of the saved connection, that asked. */
  target: string;
  /** Which login it is for, so the field can say so. */
  user: string;
  /** Whether a stored password was already tried and refused. */
  refused: boolean;
};

export function PasswordPrompt({
  user,
  refused,
  pending,
  onSubmit,
  onCancel,
  className,
}: {
  /** The login it is for; blank when the connection never named one. */
  user: string;
  /** A stored password was tried and refused, as opposed to none having been offered yet. */
  refused: boolean;
  pending: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
  className?: string;
}): React.ReactElement {
  const [password, setPassword] = React.useState("");
  const field = React.useRef<HTMLInputElement>(null);

  // The prompt appears because the user pressed Connect, so the caret belongs in the one field
  // they now have to fill in — not a click away from it.
  React.useEffect(() => field.current?.focus(), []);

  const submit = (): void => {
    if (pending || password.length === 0) return;
    onSubmit(password);
  };

  return (
    <div className={cn("flex flex-col gap-1.5 border-border border-t px-2 py-2", className)}>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <KeyRoundIcon className="size-3 shrink-0" />
        {refused ? "That password was refused" : "This server wants a password"}
        {user !== "" && <span className="font-mono">for {user}</span>}
      </p>
      <div className="flex items-center gap-2">
        <Input
          aria-label={user === "" ? "Password" : `Password for ${user}`}
          autoComplete="off"
          className="h-7"
          onKeyDown={(event) => {
            // Its own handler rather than a nested <form>: this sits inside the onboarding form,
            // and a form cannot contain one.
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          onValueChange={setPassword}
          ref={field}
          type="password"
          value={password}
        />
        <Button className="shrink-0" onClick={onCancel} size="xs" variant="ghost">
          Cancel
        </Button>
        <Button
          className="shrink-0"
          disabled={password.length === 0}
          loading={pending}
          onClick={submit}
          size="xs"
          variant="outline"
        >
          Connect
        </Button>
      </div>
    </div>
  );
}
