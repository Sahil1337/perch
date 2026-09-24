// The answer to the commonest reason a database refuses a connection.
//
// A server on a default port, in a container, or behind any auth method other than trust says
// "password" and nothing else. That is not a reason to throw away everything discovery worked
// out and hand back an empty seven-field form — the address is right, one or two things are
// missing. So the row that failed grows those fields, and keeps its place in the list.
//
// The login is one of them, because it is a guess. Nothing below this screen can know which role
// a given install created — `postgres`, the OS user, whatever an image was started with — and
// Postgres reports an unknown role and a wrong password with the same sentence, on purpose, so
// neither this code nor the person reading it can tell the two apart. A prompt that only takes a
// password is therefore unanswerable whenever the guess was wrong: the correct password is
// refused, every time, with no way to say who it is for. Both fields, and it is answerable.

import { KeyRoundIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { PasswordInput } from "../ui/password-input";

/**
 * A server that answered and asked for a password. It is not an error state: nothing is wrong yet,
 * the server has simply said what it needs, so the row grows a field rather than the screen
 * growing a red box and seven of them.
 */
export type PasswordChallenge = {
  /** The `serverKey` of the discovered row, or the id of the saved connection, that asked. */
  target: string;
  /** The login that was tried, which the prompt offers for correction. */
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
  /** The login that was tried; blank when the connection never named one. */
  user: string;
  /** A stored password was tried and refused, as opposed to none having been offered yet. */
  refused: boolean;
  pending: boolean;
  /** The login is passed back alongside the password: the prompt can correct either. */
  onSubmit: (password: string, user: string) => void;
  onCancel: () => void;
  className?: string;
}): React.ReactElement {
  const [password, setPassword] = React.useState("");
  // Seeded from the guess rather than driven by it: this is now an editable value, and a prop
  // that kept overwriting it would undo what the user typed on every re-render.
  const [login, setLogin] = React.useState(user);
  const field = React.useRef<HTMLInputElement>(null);

  // The prompt appears because the user pressed Connect, so the caret belongs in the field they
  // now have to fill in — the password, since the login usually already holds the right answer.
  React.useEffect(() => field.current?.focus(), []);

  const submit = (): void => {
    if (pending || password.length === 0) return;
    onSubmit(password, login.trim());
  };

  // Its own handler rather than a nested <form>: this sits inside the onboarding form, and a
  // form cannot contain one. Shared by both fields so Enter submits from either.
  const keys = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <div className={cn("flex flex-col gap-1.5 border-border border-t px-2 py-2", className)}>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <KeyRoundIcon className="size-3 shrink-0" />
        {refused
          ? "That login was refused — check the user as well as the password"
          : "This server wants a user and password"}
      </p>
      <div className="flex items-center gap-2">
        <Input
          aria-label="User"
          autoComplete="off"
          className="h-7 w-32 shrink-0"
          onKeyDown={keys}
          onValueChange={setLogin}
          placeholder="user"
          spellCheck={false}
          value={login}
        />
        <PasswordInput
          aria-label={login === "" ? "Password" : `Password for ${login}`}
          autoComplete="off"
          className="h-7"
          onKeyDown={keys}
          onValueChange={setPassword}
          placeholder="password"
          ref={field}
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
