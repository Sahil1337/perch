// The latest GitHub release and the visitor's platform. Every link the components render already
// works before this answers: it points at the releases page, which is also where everything falls
// back to if the API is down, rate-limited or slow. Detection only sharpens a link that works.

const REPO = "Sahil1337/perch";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const REPO_URL = `https://github.com/${REPO}`;
export const RELEASES_URL = `${REPO_URL}/releases/latest`;
export const INSTALL_COMMAND = `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh`;
const CACHE_KEY = "perch:release";
const TIMEOUT_MS = 6000;

export type OS = "darwin" | "linux" | "windows" | "unknown";
export type Arch = "arm64" | "amd64";

export type Asset = {
  name: string;
  url: string;
  /** Bytes. */
  size: number;
  os: Exclude<OS, "unknown">;
  arch: Arch;
  /** "macOS · Apple silicon" */
  label: string;
  kind: ".tar.gz" | ".exe";
  /** "14.2 MB" */
  sizeLabel: string;
};

export type Release = {
  status: "loading" | "ready" | "fallback";
  /** The tag, "v0.2.0", once the API has answered. */
  version?: string;
  /** The build for this machine, when one was found. */
  primary?: Asset;
  /** Every build in the release, in a fixed platform order. */
  assets: Asset[];
  releasesUrl: string;
  checksumsUrl?: string;
  os: OS;
  arch?: Arch;
  mobile: boolean;
};

export const OS_NAMES: Record<Exclude<OS, "unknown">, string> = { darwin: "macOS", linux: "Linux", windows: "Windows" };
export const ARCH_NAMES = {
  darwin: { arm64: "Apple silicon", amd64: "Intel" },
  linux: { amd64: "x86-64", arm64: "ARM64" },
  windows: { amd64: "x64", arm64: "ARM64" },
} as const;
const buildLabel = (os: Exclude<OS, "unknown">, arch: Arch): string => `${OS_NAMES[os]} · ${ARCH_NAMES[os][arch]}`;
/** Every build the release workflow ships, in a fixed platform order. */
export const BUILDS: { os: Exclude<OS, "unknown">; arch: Arch; label: string }[] = (
  [
    { os: "darwin", arch: "arm64" },
    { os: "darwin", arch: "amd64" },
    { os: "linux", arch: "amd64" },
    { os: "linux", arch: "arm64" },
    { os: "windows", arch: "amd64" },
  ] as const
).map((b) => ({ ...b, label: buildLabel(b.os, b.arch) }));

type RawRelease = { tag: string; url: string; assets: { name: string; size: number; url: string }[] };

type NavigatorUAData = {
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
};
const uaData = () => (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;

function detectOS(): { os: OS; mobile: boolean } {
  const ua = navigator.userAgent;
  const data = uaData();
  // iPadOS asks for desktop sites with a Mac user agent; touch is what gives it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (data?.mobile || iPad || /Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return { os: "unknown", mobile: true };
  const platform = (data?.platform || ua).toLowerCase();
  if (/mac/.test(platform)) return { os: "darwin", mobile: false };
  if (/win/.test(platform)) return { os: "windows", mobile: false };
  if (/linux|x11|cros|chrome os/.test(platform)) return { os: "linux", mobile: false };
  return { os: "unknown", mobile: false };
}

const guessArch = (os: OS): Arch | undefined => (os === "unknown" ? undefined : os === "darwin" ? "arm64" : "amd64");

async function detectArch(os: OS): Promise<Arch | undefined> {
  if (os === "unknown") return undefined;
  if (os === "windows") return "amd64";
  try {
    const hints = await uaData()?.getHighEntropyValues?.(["architecture", "bitness"]);
    if (hints?.architecture === "arm") return "arm64";
    if (hints?.architecture === "x86" && hints.bitness !== "32") return "amd64";
  } catch {
    // no hints: fall through to the user agent and the defaults
  }
  if (/aarch64|arm64|armv8/i.test(navigator.userAgent)) return "arm64";
  // Every Mac sold since 2020 is Apple silicon, and Safari and Firefox report Intel on all of them.
  return guessArch(os);
}

function readCache(): RawRelease | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as RawRelease) : null;
  } catch {
    return null;
  }
}

function writeCache(release: RawRelease) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(release));
  } catch {
    // storage full or blocked: the next page view asks the API again
  }
}

async function latestRelease(): Promise<RawRelease | null> {
  const cached = readCache();
  if (cached) return cached;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API, { headers: { Accept: "application/vnd.github+json" }, signal: controller.signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { tag_name?: unknown; html_url?: unknown; assets?: unknown };
    if (typeof data?.tag_name !== "string" || !Array.isArray(data.assets)) return null;
    const release: RawRelease = {
      tag: data.tag_name,
      url: typeof data.html_url === "string" ? data.html_url : RELEASES_URL,
      assets: (data.assets as { name?: unknown; size?: unknown; browser_download_url?: unknown }[])
        .filter((a) => typeof a?.name === "string" && typeof a.browser_download_url === "string")
        .map((a) => ({ name: a.name as string, size: Number(a.size) || 0, url: a.browser_download_url as string })),
    };
    writeCache(release);
    return release;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

function assetFor(release: RawRelease, os: Exclude<OS, "unknown">, arch: Arch): Asset | undefined {
  const version = release.tag.replace(/^v/, "");
  const name = os === "windows" ? `perch-${version}-windows-amd64.exe` : `perch-${version}-${os}-${arch}.tar.gz`;
  const found = release.assets.find((a) => a.name === name);
  if (!found) return undefined;
  return {
    ...found,
    os,
    arch,
    label: buildLabel(os, arch),
    kind: os === "windows" ? ".exe" : ".tar.gz",
    sizeLabel: megabytes(found.size),
  };
}

function build(os: OS, mobile: boolean, arch: Arch | undefined, release: RawRelease | null, settled: boolean): Release {
  const base: Release = {
    status: settled ? (release ? "ready" : "fallback") : "loading",
    assets: [],
    releasesUrl: release?.url ?? RELEASES_URL,
    os,
    arch,
    mobile,
  };
  if (!release) return base;
  const assets = BUILDS.map((b) => assetFor(release, b.os, b.arch)).filter((a): a is Asset => !!a);
  const primary = os !== "unknown" && arch ? assetFor(release, os, arch) : undefined;
  return {
    ...base,
    version: release.tag,
    primary,
    assets,
    checksumsUrl: release.assets.find((a) => a.name === "checksums.txt")?.url,
  };
}

let snapshot: Release | null = null;
let started = false;
const listeners = new Set<() => void>();

function current(): Release {
  if (!snapshot) {
    const { os, mobile } = detectOS();
    // Labelled straight away from the platform alone; the arch and the release refine it.
    snapshot = build(os, mobile, guessArch(os), null, false);
  }
  return snapshot;
}

function start() {
  if (started) return;
  started = true;
  const { os, mobile } = current();
  void Promise.all([detectArch(os), latestRelease()]).then(([arch, release]) => {
    snapshot = build(os, mobile, arch, release, true);
    for (const listener of listeners) listener();
  });
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export const getSnapshot = current;
