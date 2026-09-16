// The component library. Primitives are re-exported flat; a name collision between two
// primitives is a bug in the primitive, not a reason to namespace here.

export { cn } from "./lib/utils";
export * from "./ui/segmented-control";

export * from "./ui/autocomplete";
export * from "./ui/alert";
export * from "./ui/badge";
export * from "./ui/collapsible";
export * from "./ui/empty";
export * from "./ui/fieldset";
export * from "./ui/button";
export * from "./ui/command";
export * from "./ui/context-menu";
export * from "./ui/dropdown-menu";
export * from "./ui/input";
export * from "./ui/input-group";
export * from "./ui/kbd";
export * from "./ui/scroll-area";
export * from "./ui/separator";
export * from "./ui/skeleton";
export * from "./ui/spinner";
export * from "./ui/tabs";
export * from "./ui/toggle";
export * from "./ui/toggle-group";
export * from "./ui/tooltip";

export * from "./workspace/types";
export * from "./workspace/context";
export * from "./workspace/cells";
export * from "./workspace/app-topbar";
export * from "./workspace/status-bar";
export * from "./workspace/resizable-sidebar";
export * from "./workspace/command-palette";
export * from "./workspace/connecting-overlay";
export * from "./workspace/connection-picker";
export * from "./workspace/editor-grid";
export * from "./workspace/pane-layout";
export * from "./workspace/pane-tabs";
export * from "./workspace/files-list";
export * from "./workspace/notebook";
export * from "./workspace/results-grid";
export * from "./workspace/results-panel";
export * from "./workspace/run-button";
export * from "./workspace/save-indicator";
export * from "./workspace/save-query-dialog";
export * from "./workspace/folder-picker";
export * from "./workspace/query-walk";
export * from "./workspace/schema-diagram";
export * from "./workspace/schema-tree";
export * from "./workspace/sql-editor";
export * from "./workspace/use-hotkey";

export * from "./ui/dialog";
export * from "./ui/field";
export * from "./ui/label";
export * from "./ui/radio-group";
export * from "./ui/select";
export * from "./ui/switch";

export * from "./brand/logo";

export * from "./onboarding/onboarding";
export * from "./onboarding/connecting-screen";
export * from "./onboarding/connection-beam";
export * from "./onboarding/connection-form";
export * from "./onboarding/discovered-servers";
export * from "./onboarding/dialect-mark";
export * from "./onboarding/use-onboarding";

export * from "./settings/settings-dialog";
export * from "./settings/settings-button";
export * from "./settings/sections";
export * from "./settings/connections-section";
export * from "./settings/saved-tick";
export * from "./settings/use-editor-font-size";
export * from "./settings/theme-sync";
export * from "./lib/theme";

export * from "./workspace/server-gate";
