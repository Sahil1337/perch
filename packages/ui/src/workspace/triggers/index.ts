// The Triggers view: what fires when a table changes, and in what order. One table and one kind of
// change at a time, laid out as the stages a statement goes through — before the statement, before
// each row, the write, after each row, after the statement — with each trigger in the column where
// it runs, and an example statement that plays through them. The order is the one thing people get
// wrong about triggers, and a list of them cannot show it.

export { TriggersDialog } from "./triggers-dialog";
export {
  TRIGGERS_EVENT,
  type TriggersEventDetail,
  type TriggersFocus,
  requestTriggers,
} from "./triggers-event";
