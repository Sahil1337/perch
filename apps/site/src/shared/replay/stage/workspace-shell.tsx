// The workspace exactly as apps/web lays it out (apps/web/src/routes/index.tsx `Workspace`), filling
// the frame's app area instead of the viewport. The differences are only what a page with several
// workspaces on it needs: the parts that listen on `window` — shortcuts, the palette, the dialogs
// opened by event — are mounted only while the visitor is using this scene (see active-scene.ts).

import {
  AppTopbar,
  Button,
  CommandPalette,
  ConnectingProvider,
  ConnectionPicker,
  EditorGrid,
  FilesList,
  PerchMark,
  QueryWalkDialog,
  ResizableSidebar,
  RunButton,
  SaveIndicator,
  SaveQueryDialog,
  SchemaDiagramDialog,
  SchemaTree,
  SettingsButton,
  SidebarTabs,
  StatusBar,
  requestSaveQuery,
  useHotkey,
  useWorkspace,
} from "@perch/ui";
import { PanelLeftIcon, SettingsIcon } from "lucide-react";
import * as React from "react";
import { RunHistory } from "../../../../../web/src/run-history";
import { installSceneGuard } from "./active-scene";

installSceneGuard();

export function WorkspaceShell({ active }: { active: boolean }): React.ReactElement {
  return (
    <ConnectingProvider>
      <Workspace active={active} />
    </ConnectingProvider>
  );
}

function Workspace({ active }: { active: boolean }): React.ReactElement {
  const { panels, setPanel, togglePanel } = useWorkspace();

  useHotkey({ key: "b", mod: true }, () => togglePanel("sidebarOpen"), active);
  useHotkey({ key: "j", mod: true }, () => togglePanel("outputOpen"), active);
  useHotkey({ key: "s", mod: true }, requestSaveQuery, active);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {active && (
        <>
          <SaveQueryDialog />
          <SchemaDiagramDialog />
          <QueryWalkDialog />
        </>
      )}
      <AppTopbar
        end={
          <>
            <SaveIndicator withToggle />
            <RunButton />
            {active ? <SettingsButton /> : <SettingsGear />}
          </>
        }
        start={
          <>
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
          defaultWidth={256}
          onWidthChange={(width) => setPanel("sidebarWidth", width)}
          open={panels.sidebarOpen}
          width={panels.sidebarWidth}
        >
          <Sidebar />
        </ResizableSidebar>
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <EditorGrid
            className="min-h-0 flex-1"
            layout={panels.layout}
            onLayoutChange={(layout) => setPanel("layout", layout)}
          />
        </main>
      </div>

      <StatusBar />
      {active && <CommandPalette />}
    </div>
  );
}

function Sidebar(): React.ReactElement {
  const { panels, setPanel } = useWorkspace();
  return (
    <SidebarTabs onTabChange={(tab) => setPanel("sidebarTab", tab)} tab={panels.sidebarTab}>
      {panels.sidebarTab === "schema" && <SchemaTree className="h-full" />}
      {panels.sidebarTab === "files" && <FilesList className="h-full" />}
      {panels.sidebarTab === "history" && <RunHistory />}
    </SidebarTabs>
  );
}

/**
 * The gear while the scene is not live: SettingsButton's own trigger, drawn without the dialog and
 * the ⌘, binding it owns, which would answer every scene's shortcut at once.
 */
function SettingsGear(): React.ReactElement {
  return (
    <Button aria-label="Settings" size="icon-sm" variant="ghost">
      <SettingsIcon />
    </Button>
  );
}
