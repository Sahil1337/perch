import { cn } from "../../shared/cn";

// PerchMark's drawing (packages/ui/src/brand/logo.tsx), drawn here rather than imported so the
// nav doesn't pull the @perch/ui barrel into the first paint.
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("size-5 shrink-0", className)}
    >
      <path d="M3 20h18" />
      <path d="M11.4 17L11 20M14.6 17L14.2 20" />
      <path d="M20.5 8.2L18.3 7.2C17.8 5.3 15.5 4.4 14 5.6C13.2 6.2 12.4 6.5 11.6 7.2C10 8.6 9.6 10.85 7.9 12.2L3.95 15.3L5.55 17.35L9.3 14C10.3 15.6 13.8 18 16.2 15.6C17.6 14.2 18.4 12 18.3 10.5C18.2 9.6 18.4 9 18.6 8.9Z" />
      <circle cx="16.4" cy="6.9" r=".65" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mark and name, linking home. */
export function Brand({ className }: { className?: string }) {
  return (
    <a
      href="./"
      className={cn(
        "-ml-1 inline-flex items-center gap-2 rounded-md p-1 text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
    >
      <Mark />
      <span className="text-base/none font-medium tracking-tight">Perch</span>
    </a>
  );
}

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className={cn("size-4 shrink-0", className)}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}
