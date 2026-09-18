// The command palette: ⌘K, and everything reachable from it.
//
// Every group draws from `asyncData` — the last value that loaded, whatever the status — because a
// palette that renders nothing until the schema arrives feels broken on the first ⌘K. A group with
// nothing in it is dropped rather than shown empty.
//
// Selecting a table does not edit your SQL: there is no "insert at the cursor" in the contract, and
// inventing one would mean this package deciding what happens to someone's buffer. It reveals the
// table in the schema sidebar instead.
//
// This file is the shell: the rows live in `palette-items.ts` and the commands in
// `palette-actions.ts`, both of which say what they build without also owning the dialog.

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
} from "../../ui/command";
import { useWorkspace } from "../context";
import { useHotkey } from "../use-hotkey";
import { asyncData } from "../types";
import { useBuiltinActions } from "./palette-actions";
import {
  connectionItems,
  databaseItems,
  fileItems,
  tableItems,
  type PaletteGroup,
  type PaletteItem,
} from "./palette-items";

export function CommandPalette(): React.ReactElement {
  const {
    activeBuffer,
    activeBufferId,
    connect,
    connections,
    cursor,
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

  const revealTable = React.useCallback(() => {
    setPanel("sidebarOpen", true);
    setPanel("sidebarTab", "schema");
    close();
  }, [close, setPanel]);

  const actions = useBuiltinActions(
    {
      activeBuffer,
      activeBufferId,
      cursor,
      panels,
      newScratch,
      save,
      run,
      refreshSchema,
      togglePanel,
    },
    close,
  );

  // A schema that is refetching, or failed after loading once, is still the best answer here.
  const loadedSchema = asyncData(schema);
  const loadedConnections = asyncData(connections);
  const loadedDatabases = asyncData(databases);

  const groups: PaletteGroup[] = React.useMemo(() => {
    const actionItems: PaletteItem[] = actions.map((action, index) => ({
      ...action,
      value: `action:${index}:${action.label}`,
    }));

    // Actions first, then what you might be looking at, with tables last: leading with forty
    // tables would put a schema between you and the commands the palette is opened for, and tables
    // are the one group you reach by typing a name you already know.
    return [
      { value: "Actions", items: actionItems },
      {
        value: "Files",
        items: fileItems(buffers, (id) => {
          focusBuffer(id);
          close();
        }),
      },
      {
        value: "Connections",
        items: connectionItems(loadedConnections, (id) => {
          void connect(id);
          close();
        }),
      },
      {
        value: "Databases",
        items: databaseItems(loadedDatabases, database, (name) => {
          void selectDatabase(name);
          close();
        }),
      },
      { value: "Tables", items: tableItems(loadedSchema, revealTable) },
    ].filter((group) => group.items.length > 0);
  }, [
    actions,
    buffers,
    close,
    connect,
    database,
    focusBuffer,
    loadedConnections,
    loadedDatabases,
    loadedSchema,
    revealTable,
    selectDatabase,
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
