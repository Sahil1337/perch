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

type Table struct {
	Schema      string       `json:"schema"`
	Name        string       `json:"name"`
	Kind        TableKind    `json:"kind"`
	Columns     []Column     `json:"columns"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
	RowEstimate *int64       `json:"rowEstimate,omitempty"`
}

type Schema struct {
	Name   string  `json:"name"`
	Tables []Table `json:"tables"`
}

type DatabaseSchema struct {
	Database  string   `json:"database"`
	Schemas   []Schema `json:"schemas"`
	FetchedAt string   `json:"fetchedAt"`
}
