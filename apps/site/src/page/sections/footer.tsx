import type { Ref } from "react";
import { cn } from "../../shared/cn";
import { Perch } from "../layout/perch";
import { Container } from "../layout/container";
import { small } from "../layout/type";
import { Brand } from "../chrome/mark";

const REPO = "https://github.com/Sahil1337/perch";

const LINKS = [
  { href: REPO, label: "GitHub" },
  { href: `${REPO}/blob/main/CHANGELOG.md`, label: "Changelog" },
  { href: `${REPO}/releases`, label: "Releases" },
  { href: `${REPO}/issues`, label: "Issues" },
];

const link =
  "rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** `perchRef`: the bird's last resort, on the brand, for a phone scrolled past the return key. */
export function Footer({ perchRef }: { perchRef?: Ref<HTMLDivElement> }) {
  return (
    <footer className="relative mt-20 lg:mt-32">
      <Container className={cn(small, "flex flex-wrap items-center gap-x-8 gap-y-4 pt-10 pb-12")}>
        <div className="relative">
          <Perch ref={perchRef} />
          <Brand />
        </div>
        {/* Under sm the project links take a line of their own and the licence sits beside the
            brand, so the row wraps into two tidy lines rather than leaving one link stranded. */}
        <nav aria-label="Project" className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((item) => (
              <li key={item.label}>
                <a href={item.href} className={link}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <a href={`${REPO}/blob/main/LICENSE`} className={cn(link, "ml-auto sm:ml-0")}>
          MIT License
        </a>
      </Container>
    </footer>
  );
}
