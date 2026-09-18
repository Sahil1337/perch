package db

import (
	"strings"
	"unicode"
)

// stripLeadingNoise drops leading whitespace, comments and open parens, returning the script
// from the first character that could begin a keyword. Both dialects classify a statement from
// its text — Postgres to decide whether to open a cursor, MySQL to invent the command tag it
// never receives — and both look past the same noise. Returns "" for a script that is nothing
// but noise, or an unterminated comment.
func stripLeadingNoise(sql string) string {
	i := 0
	for {
		for i < len(sql) && unicode.IsSpace(rune(sql[i])) {
			i++
		}
		if strings.HasPrefix(sql[i:], "--") {
			nl := strings.IndexByte(sql[i:], '\n')
			if nl == -1 {
				return ""
			}
			i += nl + 1
			continue
		}
		if strings.HasPrefix(sql[i:], "/*") {
			end := strings.Index(sql[i+2:], "*/")
			if end == -1 {
				return ""
			}
			i += 2 + end + 2
			continue
		}
		if i < len(sql) && sql[i] == '(' {
			i++
			continue
		}
		return sql[i:]
	}
}

// firstWord is the leading keyword of a statement, lower-cased.
func firstWord(sql string) string {
	head := stripLeadingNoise(sql)
	end := 0
	for end < len(head) {
		c := head[end]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') {
			end++
			continue
		}
		break
	}
	return strings.ToLower(head[:end])
}
