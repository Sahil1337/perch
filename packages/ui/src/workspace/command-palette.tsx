"use client";

// The command palette: ⌘K, and everything reachable from it.
//
// Every group draws from `asyncData` — the last value that loaded, whatever the status — because a
// palette that renders nothing until the schema arrives feels broken on the first ⌘K. A group with
// nothing in it is dropped rather than shown empty.
//
// Selecting a table does not edit your SQL: there is no "insert at the cursor" in the contract, and
// inventing one would mean this package deciding what happens to someone's buffer. The default is
// to reveal the table in the sidebar, and `onSelectTable` lets the app do something better.

import type { Table } from "@perch/protocol";
import type { LucideIcon } from "lucide-react";
import {
  DatabaseIcon,
  EyeIcon,
  FileIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  Table2Icon,
  WandSparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import * as React from "react";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "../ui/command";
import { useWorkspace } from "./context";
import { requestSchemaDiagram } from "./schema-diagram";
import { FORMAT_DOCUMENT_EVENT, type FormatDocumentEventDetail } from "./sql-editor";
import { hotkeyLabel, useHotkey } from "./use-hotkey";
import { asyncData } from "./types";

/** An entry the app wants in the palette. Same shape the built-in actions use. */
export type PaletteAction = {
  label: string;
  hint?: string;
  shortcut?: string;
  icon?: LucideIcon;
  onSelect: () => void;
};

type PaletteItem = PaletteAction & { value: string };
type PaletteGroup = { value: string; items: PaletteItem[] };

const NEW_FILE = { key: "n", mod: true } as const;
const SAVE = { key: "s", mod: true } as const;
const RUN = { key: "Enter", mod: true } as const;
const TOGGLE_RESULTS = { key: "j", mod: true } as const;
const TOGGLE_SIDEBAR = { key: "b", mod: true } as const;
// No `mod`: the editor's own binding is a bare Shift-Alt-F.
const FORMAT_DOCUMENT = { key: "f", shift: true, alt: true } as const;

export function CommandPalette({
  extraActions,
  onSelectTable,
}: {
  extraActions?: readonly PaletteAction[];
  /** Given the table that was picked. Defaults to revealing it in the schema sidebar. */
  onSelectTable?: (table: Table) => void;
} = {}): React.ReactElement {
  const {
    activeBufferId,
    connect,
    connections,
    database,
    databases,
    buffers,
    focusBuffer,
    newScratch,
    panels,
    refreshSchema,
    run,
    save,
    schema,
    selectDatabase,
    setPanel,
    togglePanel,
  } = useWorkspace();

  const [query, setQuery] = React.useState("");

  useHotkey({ key: "k", mod: true }, () => togglePanel("paletteOpen"));

  const close = React.useCallback(() => setPanel("paletteOpen", false), [setPanel]);

  const revealTable = React.useCallback(
    (table: Table) => {
      if (onSelectTable) {
        onSelectTable(table);
        return;
      }
      setPanel("sidebarOpen", true);
      setPanel("sidebarTab", "schema");
    },
    [onSelectTable, setPanel],
  );

  // A schema that is refetching, or failed after loading once, is still the best answer here.
  const loadedSchema = asyncData(schema);
  const loadedConnections = asyncData(connections);
  const loadedDatabases = asyncData(databases);

  const groups: PaletteGroup[] = React.useMemo(() => {
    const tables: PaletteItem[] = (loadedSchema?.schemas ?? []).flatMap((group) =>
      group.tables.map((table) => ({
        value: `table:${group.name}.${table.name}`,
        label: table.name,
        hint: `${group.name} · ${plural(table.columns.length, "column")}`,
        icon: table.kind === "view" ? EyeIcon : Table2Icon,
        onSelect: () => {
          revealTable(table);
          close();
        },
      })),
    );

    const openFiles: PaletteItem[] = buffers.map((file) => ({
      value: `file:${file.id}`,
      label: file.name,
      hint: file.dirty ? "unsaved" : undefined,
      icon: FileIcon,
      onSelect: () => {
        focusBuffer(file.id);
        close();
      },
    }));

    const connectionItems: PaletteItem[] = (loadedConnections ?? []).map((connection) => ({
      value: `connection:${connection.id}`,
      label: connection.name,
      hint: `${connection.host}:${connection.port}`,
      icon: DatabaseIcon,
      onSelect: () => {
        void connect(connection.id);
        close();
      },
    }));

    // Free from the contract: switching database without reaching for the picker.
    const databaseItems: PaletteItem[] = (loadedDatabases ?? [])
      .filter((name) => name !== database)
      .map((name) => ({
        value: `database:${name}`,
        label: name,
        hint: "switch database",
        icon: DatabaseIcon,
        onSelect: () => {
          void selectDatabase(name);
          close();
        },
      }));

    const actions: readonly PaletteAction[] = [
      {
        label: "New file",
        shortcut: hotkeyLabel(NEW_FILE),
        icon: PlusIcon,
        onSelect: () => {
          newScratch();
          close();
        },
      },
      {
        label: "Save",
        shortcut: hotkeyLabel(SAVE),
        icon: SaveIcon,
        onSelect: () => {
          void save();
          close();
        },
      },
      {
        label: "Run",
        shortcut: hotkeyLabel(RUN),
        icon: PlayIcon,
        onSelect: () => {
          void run();
          close();
        },
      },
      {
        label: "Format document",
        shortcut: hotkeyLabel(FORMAT_DOCUMENT),
        icon: WandSparklesIcon,
        onSelect: () => {
          // The key is bound inside CodeMirror, which needs a keydown reaching the focused
          // editor; this dispatches the same action for the active buffer, and no-ops when
          // nothing is open.
          if (activeBufferId) {
            window.dispatchEvent(
              new CustomEvent<FormatDocumentEventDetail>(FORMAT_DOCUMENT_EVENT, {
                detail: { bufferId: activeBufferId },
              }),
            );
          }
          close();
        },
      },
      {
        label: "Refresh schema",
        hint: "bypasses the server cache",
        icon: RefreshCwIcon,
        onSelect: () => {
          void refreshSchema();
          close();
        },
      },
      {
        label: "Visualise relationships",
        hint: "Tables and the keys that join them",
        icon: WaypointsIcon,
        onSelect: () => {
          requestSchemaDiagram();
          close();
        },
      },
      {
        label: panels.outputOpen ? "Hide results" : "Show results",
        shortcut: hotkeyLabel(TOGGLE_RESULTS),
        icon: PanelBottomIcon,
        onSelect: () => {
          togglePanel("outputOpen");
          close();
        },
      },
      {
        label: panels.sidebarOpen ? "Hide sidebar" : "Show sidebar",
        shortcut: hotkeyLabel(TOGGLE_SIDEBAR),
        icon: PanelLeftIcon,
        onSelect: () => {
          togglePanel("sidebarOpen");
          close();
        },
      },
      ...(extraActions ?? []),
    ];

    const actionItems: PaletteItem[] = actions.map((action, index) => ({
      ...action,
      value: `action:${index}:${action.label}`,
    }));

    // Actions first, then what you might be looking at, with tables last: leading with forty
    // tables would put a schema between you and the commands the palette is opened for, and tables
    // are the one group you reach by typing a name you already know.
    return [
      { value: "Actions", items: actionItems },
      { value: "Files", items: openFiles },
      { value: "Connections", items: connectionItems },
      { value: "Databases", items: databaseItems },
      { value: "Tables", items: tables },
    ].filter((group) => group.items.length > 0);
  }, [
    activeBufferId,
    close,
    connect,
    database,
    extraActions,
    buffers,
    focusBuffer,
    loadedConnections,
    loadedDatabases,
    loadedSchema,
    newScratch,
    panels.outputOpen,
    panels.sidebarOpen,
    refreshSchema,
    revealTable,
    run,
    save,
    selectDatabase,
    togglePanel,
  ]);

  return (
    <CommandDialog
      onOpenChange={(open) => {
        setPanel("paletteOpen", open);
        // Every ⌘K starts from a blank query; a palette that reopens mid-search is disorienting.
        if (open) setQuery("");
      }}
      open={panels.paletteOpen}
    >
      <CommandDialogPopup aria-label="Command palette">
        <Command items={groups} onValueChange={setQuery} value={query}>
          <CommandInput placeholder="Search tables, buffers, commands…" />
          <CommandPanel>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandList>
              {(group: PaletteGroup) => (
                <CommandGroup items={group.items} key={group.value}>
                  <CommandGroupLabel>{group.value}</CommandGroupLabel>
                  <CommandCollection>
                    {(item: PaletteItem) => (
                      <CommandItem key={item.value} onClick={item.onSelect} value={item}>
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          {item.icon && <item.icon className="size-3.5 shrink-0" />}
                          <span className="truncate">{item.label}</span>
                          {item.hint && (
                            <span className="truncate text-muted-foreground text-xs">
                              {item.hint}
                            </span>
                          )}
                        </span>
                        {item.shortcut && <CommandShortcut>{item.shortcut}</CommandShortcut>}
                      </CommandItem>
                    )}
                  </CommandCollection>
                </CommandGroup>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <span>↑↓ navigate · ↵ select · esc close</span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
