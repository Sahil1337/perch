"use client";

// The workspace shell: three panes, with the results sheet docked below the editor.
//
// Everything below is live, always: `useAppWorkspace` is @perch/client against `perch serve` and
// there is no other provider. No fixture fallback — when the server is not answering the app says
// so and stops, rather than filling the panes with data nobody asked for.

import {
  AppTopbar,
  CommandPalette,
  ConnectionPicker,
  EditorGrid,
  FilesList,
  Onboarding,
  PerchMark,
  ResizableSidebar,
  RunButton,
  SaveIndicator,
  SchemaTree,
  ServerGate,
  SettingsButton,
  ThemeSync,
  StatusBar,
  ToggleGroup,
  ToggleGroupItem,
  WorkspaceProvider,
  useHotkey,
  ConnectingProvider,
  useOnboardingFlow,
  requestSaveQuery,
  QueryWalkDialog,
  SaveQueryDialog,
  SchemaDiagramDialog,
  useWorkspace,
  type SidebarTab,
} from "@perch/ui";
import { PanelLeftIcon } from "lucide-react";
import * as React from "react";
import { useAppWorkspace } from "@/lib/app-workspace";
import { DEFAULT_PANELS } from "@/lib/use-panels";
import { RunHistory } from "./run-history";

export default function Page(): React.ReactElement {
  const workspace = useAppWorkspace();
  return (
    <WorkspaceProvider value={workspace}>
      <ThemeSync />
      <Shell />
    </WorkspaceProvider>
  );
}

/**
 * The three things the app can be, in the order their preconditions come true. A server that is not
 * answering makes every pane below a lie, so `<ServerGate>` owns the screen until that is fixed;
 * a first run then gets the welcome flow rather than an empty workspace.
 *
 * Both hooks run on every render, before any branch, or the hook order would change underneath React
 * as probes land.
 */
function Shell(): React.ReactElement {
  const { server } = useWorkspace();
  const onboarding = useOnboardingFlow();

  if (server.status !== "ready") return <ServerGate />;
  if (onboarding.open) return <Onboarding onDone={onboarding.done} />;

  // Wraps the workspace, not the shell: the flow above returns this screen in place of itself.
  return (
    <ConnectingProvider>
      <Workspace />
    </ConnectingProvider>
  );
}

function Workspace(): React.ReactElement {
  const { panels, setPanel, togglePanel } = useWorkspace();

  useHotkey({ key: "b", mod: true }, () => togglePanel("sidebarOpen"));
  useHotkey({ key: "j", mod: true }, () => togglePanel("outputOpen"));
  // Asks where to put it when the buffer has never been saved; an ordinary save otherwise.
  useHotkey({ key: "s", mod: true }, requestSaveQuery);

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      {/* Mounted once, for ⌘S and the save menu alike — see save-query-dialog. */}
      <SaveQueryDialog />
      {/* Likewise: the sidebar button and the palette both open it by event. */}
      <SchemaDiagramDialog />
      {/* And the editor's context menu and the palette open this one. */}
      <QueryWalkDialog />
      <AppTopbar
        end={
          <>
            <SaveIndicator withToggle />
            <RunButton />
            <SettingsButton />
          </>
        }
        start={
          <>
            {/* The mark, not the wordmark: the topbar is the app you are already inside, so the
                identity only has to be present, and the name would cost the connection picker the
                width it needs for a long database name. */}
            <span aria-label="Perch" className="flex items-center pr-1 pl-0.5" role="img">
              <PerchMark className="size-5" />
            </span>
            <div aria-hidden className="mr-0.5 h-4 w-px bg-border" />
            <button
              aria-label="Toggle sidebar"
              className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => togglePanel("sidebarOpen")}
              type="button"
            >
              <PanelLeftIcon className="size-4" />
            </button>
            <ConnectionPicker />
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <ResizableSidebar
          defaultWidth={DEFAULT_PANELS.sidebarWidth}
          onWidthChange={(width) => setPanel("sidebarWidth", width)}
          open={panels.sidebarOpen}
          width={panels.sidebarWidth}
        >
          <Sidebar />
        </ResizableSidebar>

        {/* Tabs, editors and the results pane all live in the grid now: the shell's job is to give
            it the space left over after the sidebar, and to persist what the user rearranges. */}
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorGrid
            className="min-h-0 flex-1"
            layout={panels.layout}
            onLayoutChange={(layout) => setPanel("layout", layout)}
          />
        </main>
      </div>

      <StatusBar />
      <CommandPalette />
    </div>
  );
}

const TABS: readonly { value: SidebarTab; label: string }[] = [
  { value: "schema", label: "Schema" },
  { value: "files", label: "Files" },
  { value: "history", label: "History" },
];

function Sidebar(): React.ReactElement {
  const { panels, setPanel } = useWorkspace();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <ToggleGroup
          className="w-full"
          onValueChange={(value: string[]) => {
            const next = value[0] as SidebarTab | undefined;
            if (next) setPanel("sidebarTab", next);
          }}
          value={[panels.sidebarTab]}
          variant="outline"
        >
          {TABS.map((tab) => (
            <ToggleGroupItem className="flex-1" key={tab.value} size="sm" value={tab.value}>
              {tab.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {panels.sidebarTab === "schema" && <SchemaTree className="h-full" />}
        {panels.sidebarTab === "files" && <FilesList className="h-full" />}
        {panels.sidebarTab === "history" && <RunHistory />}
      </div>
    </div>
  );
}
