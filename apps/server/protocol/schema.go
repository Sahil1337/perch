package protocol

type Column struct {
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Nullable bool    `json:"nullable"`
	Default  *string `json:"default"`
	PK       bool    `json:"pk"`
	Position int     `json:"position"`
}

// Composite keys carry several columns, paired with RefColumns by index.
type ForeignKey struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete"`
	OnUpdate   string   `json:"onUpdate"`
}

type TableKind string

const (
	KindTable            TableKind = "table"
	KindView             TableKind = "view"
	KindMaterializedView TableKind = "materialized_view"
)

type TriggerTiming string

const (
	TimingBefore    TriggerTiming = "before"
	TimingAfter     TriggerTiming = "after"
	TimingInsteadOf TriggerTiming = "instead_of"
)

// Not TriggerEvent: an *Event type is a wire message in this package.
type TriggerOperation string

const (
	OperationInsert   TriggerOperation = "insert"
	OperationUpdate   TriggerOperation = "update"
	OperationDelete   TriggerOperation = "delete"
	OperationTruncate TriggerOperation = "truncate"
)

type TriggerLevel string

const (
	LevelRow       TriggerLevel = "row"
	LevelStatement TriggerLevel = "statement"
)

// pg_trigger.tgenabled O, D, R and A. A replica trigger fires only when session_replication_role
// is replica; an always trigger fires whatever it is.
type TriggerState string

const (
	StateEnabled  TriggerState = "enabled"
	StateDisabled TriggerState = "disabled"
	StateReplica  TriggerState = "replica"
	StateAlways   TriggerState = "always"
)

type TriggerFunctionRef struct {
	Schema string `json:"schema"`
	Name   string `json:"name"`
}

type Trigger struct {
	Name              string             `json:"name"`
	Timing            TriggerTiming      `json:"timing"`
	Operations        []TriggerOperation `json:"operations"`
	Columns           []string           `json:"columns"`
	Level             TriggerLevel       `json:"level"`
	Condition         *string            `json:"condition"`
	Function          TriggerFunctionRef `json:"function"`
	Arguments         []string           `json:"arguments"`
	State             TriggerState       `json:"state"`
	Constraint        bool               `json:"constraint"`
	InitiallyDeferred bool               `json:"initiallyDeferred"`
	TransitionTables  bool               `json:"transitionTables"`
	Comment           *string            `json:"comment"`
	Definition        string             `json:"definition"`
}

type TriggerFunction struct {
	Schema    string  `json:"schema"`
	Name      string  `json:"name"`
	Language  string  `json:"language"`
	Extension *string `json:"extension"`
}

type Table struct {
	Schema      string       `json:"schema"`
	Name        string       `json:"name"`
	Kind        TableKind    `json:"kind"`
	Columns     []Column     `json:"columns"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
	Triggers    []Trigger    `json:"triggers"`
	RowEstimate *int64       `json:"rowEstimate,omitempty"`
	IsPartition bool         `json:"isPartition,omitempty"`
}

type Schema struct {
	Name   string  `json:"name"`
	Tables []Table `json:"tables"`
}

type DatabaseSchema struct {
	Database         string            `json:"database"`
	Schemas          []Schema          `json:"schemas"`
	TriggerFunctions []TriggerFunction `json:"triggerFunctions"`
	ServerVersionNum *int              `json:"serverVersionNum"`
	FetchedAt        string            `json:"fetchedAt"`
}
