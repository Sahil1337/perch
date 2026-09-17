// The relationship view: every table as a card of typed columns, every foreign key as a wire from
// the column that holds it to the key it points at. Drawn here rather than handed to a diagram
// library because the two things this view exists for — a wire that starts at *this* column and
// a pulse that travels along it — are exactly what a text-to-SVG renderer cannot give back.

export { SchemaDiagramDialog } from "./schema-diagram-dialog";
export {
  SCHEMA_DIAGRAM_EVENT,
  type SchemaDiagramEventDetail,
  requestSchemaDiagram,
} from "./schema-diagram-event";
