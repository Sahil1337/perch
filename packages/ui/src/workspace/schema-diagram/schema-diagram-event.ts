export const SCHEMA_DIAGRAM_EVENT = "perch:visualise";

export type SchemaDiagramEventDetail = {
  /** `schema.table` to select and centre on when the view opens. */
  focus?: string;
};

/**
 * Opens the relationship view from anywhere — the sidebar button, the palette — without the caller
 * owning the dialog. `<SchemaDiagramDialog>` is mounted once in the shell and listens.
 */
export function requestSchemaDiagram(focus?: string): void {
  window.dispatchEvent(
    new CustomEvent<SchemaDiagramEventDetail>(SCHEMA_DIAGRAM_EVENT, { detail: { focus } }),
  );
}
