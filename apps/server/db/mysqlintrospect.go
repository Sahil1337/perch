package db

import (
	"context"
	"database/sql"
	"strings"

	"perch/protocol"
)

// MySQL's "schema" and "database" are the same thing, so the tree always has exactly one schema:
// the target database.
func (d *mysqlDriver) GetSchema(ctx context.Context, database string) (protocol.DatabaseSchema, error) {
	target := database
	if target == "" {
		target = d.config.Database
	}
	handle, err := d.dbFor(ctx, database)
	if err != nil {
		return protocol.DatabaseSchema{}, err
	}
	return readMysqlSchema(ctx, handle, target)
}

func readMysqlSchema(ctx context.Context, handle *sql.DB, target string) (protocol.DatabaseSchema, error) {
	var zero protocol.DatabaseSchema

	columnsByTable := map[string][]protocol.Column{}
	rows, err := handle.QueryContext(ctx, `select c.table_name, c.column_name, c.column_type,
			c.is_nullable, c.column_default, c.ordinal_position, c.column_key
		from information_schema.columns c
		where c.table_schema = ?
		order by c.table_name, c.ordinal_position`, target)
	if err != nil {
		return zero, err
	}
	for rows.Next() {
		var tableName, nullable, columnKey string
		var column protocol.Column
		if err := rows.Scan(&tableName, &column.Name, &column.Type, &nullable,
			&column.Default, &column.Position, &columnKey); err != nil {
			rows.Close()
			return zero, err
		}
		column.Nullable = strings.EqualFold(nullable, "YES")
		column.PK = strings.EqualFold(columnKey, "PRI")
		columnsByTable[tableName] = append(columnsByTable[tableName], column)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	// One row per foreign-key column; the rows of a constraint arrive adjacent and in
	// ordinal_position order, so a composite key keeps its column pairing.
	fksByTable := map[string][]protocol.ForeignKey{}
	rows, err = handle.QueryContext(ctx, `select k.table_name, k.constraint_name, k.column_name,
			k.referenced_table_schema, k.referenced_table_name, k.referenced_column_name,
			r.delete_rule, r.update_rule
		from information_schema.key_column_usage k
		join information_schema.referential_constraints r
		  on r.constraint_schema = k.constraint_schema
		 and r.constraint_name = k.constraint_name
		 and r.table_name = k.table_name
		where k.table_schema = ?
		  and k.referenced_table_name is not null
		order by k.table_name, k.constraint_name, k.ordinal_position`, target)
	if err != nil {
		return zero, err
	}
	for rows.Next() {
		var tableName, name, column, refColumn, deleteRule, updateRule string
		var refSchema, refTable *string
		if err := rows.Scan(&tableName, &name, &column, &refSchema, &refTable, &refColumn,
			&deleteRule, &updateRule); err != nil {
			rows.Close()
			return zero, err
		}
		list := fksByTable[tableName]
		at := -1
		for i := range list {
			if list[i].Name == name {
				at = i
				break
			}
		}
		if at == -1 {
			fk := protocol.ForeignKey{
				Name:       name,
				Columns:    []string{},
				RefSchema:  target,
				RefColumns: []string{},
				OnDelete:   strings.ToUpper(orDefault(deleteRule, "NO ACTION")),
				OnUpdate:   strings.ToUpper(orDefault(updateRule, "NO ACTION")),
			}
			if refSchema != nil {
				fk.RefSchema = *refSchema
			}
			if refTable != nil {
				fk.RefTable = *refTable
			}
			list = append(list, fk)
			at = len(list) - 1
		}
		list[at].Columns = append(list[at].Columns, column)
		list[at].RefColumns = append(list[at].RefColumns, refColumn)
		fksByTable[tableName] = list
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	rows, err = handle.QueryContext(ctx, `select table_name, table_type, table_rows
		from information_schema.tables
		where table_schema = ?
		order by table_name`, target)
	if err != nil {
		return zero, err
	}
	schema := protocol.Schema{Name: target, Tables: []protocol.Table{}}
	for rows.Next() {
		var name string
		var tableType *string
		var tableRows *int64
		if err := rows.Scan(&name, &tableType, &tableRows); err != nil {
			rows.Close()
			return zero, err
		}
		table := protocol.Table{
			Schema:      target,
			Name:        name,
			Kind:        protocol.KindTable,
			Columns:     columnsByTable[name],
			ForeignKeys: fksByTable[name],
		}
		if tableType != nil && strings.Contains(strings.ToUpper(*tableType), "VIEW") {
			table.Kind = protocol.KindView
		}
		if table.Columns == nil {
			table.Columns = []protocol.Column{}
		}
		if table.ForeignKeys == nil {
			table.ForeignKeys = []protocol.ForeignKey{}
		}
		if tableRows != nil && *tableRows >= 0 {
			table.RowEstimate = tableRows
		}
		schema.Tables = append(schema.Tables, table)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return zero, err
	}

	return protocol.DatabaseSchema{
		Database:  target,
		Schemas:   []protocol.Schema{schema},
		FetchedAt: protocol.Now(),
	}, nil
}

func orDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
