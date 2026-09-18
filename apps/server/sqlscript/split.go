// Package sqlscript splits a SQL script into statements without a real parser: only the
// top-level semicolons matter, so strings, identifiers, comments and dollar-quoted bodies are
// skipped verbatim.
//
// packages/sql/src/split.ts is the same rule in TypeScript, because the editor needs the ranges
// the server will run. Change one, change the other — two languages cannot be diffed, so nothing
// checks this for you.
package sqlscript

import (
	"strings"
	"unicode"
	"unicode/utf16"
)

type Statement struct {
	// Whitespace-trimmed, never empty.
	SQL string
	// Offset of SQL[0] in the original script, in UTF-16 code units — what the editor counts.
	Offset int
}

func isSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r' || r == '\f' || r == '\v'
}

// Split returns the statements in sql. Blank chunks (whitespace and comments only) are dropped.
func Split(sql string) []Statement {
	src := []rune(sql)
	out := make([]Statement, 0)
	start, i := 0, 0

	push := func(from, to int) {
		chunk := src[from:to]
		if isBlank(chunk) {
			return
		}
		s, e := 0, len(chunk)
		for s < e && isSpace(chunk[s]) {
			s++
		}
		for e > s && isSpace(chunk[e-1]) {
			e--
		}
		out = append(out, Statement{
			SQL:    string(chunk[s:e]),
			Offset: len(utf16.Encode(src[:from+s])),
		})
	}

	for i < len(src) {
		switch {
		case src[i] == '\'' || src[i] == '"':
			i = skipQuoted(src, i, src[i], true)
		case src[i] == '`':
			i = skipQuoted(src, i, '`', false)
		case src[i] == '-' && peek(src, i+1) == '-':
			i = skipLineComment(src, i)
		case src[i] == '/' && peek(src, i+1) == '*':
			i = skipBlockComment(src, i)
		case src[i] == '$':
			if next := skipDollarQuoted(src, i); next != i {
				i = next
			} else {
				i++
			}
		case src[i] == ';':
			push(start, i)
			start = i + 1
			i++
		default:
			i++
		}
	}
	push(start, len(src))
	return out
}

func peek(src []rune, i int) rune {
	if i < 0 || i >= len(src) {
		return 0
	}
	return src[i]
}

// skipQuoted consumes a quoted run starting at the opening quote. Doubling escapes the quote
// ('it”s'). Backslash escapes are honoured for ' and " because MySQL and PostgreSQL's E'...'
// literals use them, which makes a lone trailing backslash in a standard-conforming literal
// ('\') look unterminated — a much rarer shape than '\”.
func skipQuoted(src []rune, i int, quote rune, backslashEscapes bool) int {
	for j := i + 1; j < len(src); j++ {
		if backslashEscapes && src[j] == '\\' {
			j++
			continue
		}
		if src[j] == quote {
			if peek(src, j+1) == quote {
				j++
				continue
			}
			return j + 1
		}
	}
	return len(src)
}

func skipLineComment(src []rune, i int) int {
	for j := i; j < len(src); j++ {
		if src[j] == '\n' {
			return j + 1
		}
	}
	return len(src)
}

// Block comments nest, as PostgreSQL allows.
func skipBlockComment(src []rune, i int) int {
	depth := 1
	j := i + 2
	for j < len(src) {
		switch {
		case src[j] == '/' && peek(src, j+1) == '*':
			depth++
			j += 2
		case src[j] == '*' && peek(src, j+1) == '/':
			depth--
			j += 2
			if depth == 0 {
				return j
			}
		default:
			j++
		}
	}
	return len(src)
}

// skipDollarQuoted consumes a $tag$ ... $tag$ body, returning i unchanged when this $ opens no
// tag (the $1 of a placeholder), so the caller keeps scanning normally.
func skipDollarQuoted(src []rune, i int) int {
	tag := dollarTag(src, i)
	if tag == "" {
		return i
	}
	rest := string(src[i+len([]rune(tag)):])
	end := strings.Index(rest, tag)
	if end == -1 {
		return len(src)
	}
	return i + len([]rune(tag)) + len([]rune(rest[:end])) + len([]rune(tag))
}

// dollarTag matches ^\$([A-Za-z_\x80-￿][A-Za-z0-9_\x80-￿]*)?\$ at i.
func dollarTag(src []rune, i int) string {
	j := i + 1
	for j < len(src) && j-i <= 64 {
		r := src[j]
		if r == '$' {
			return string(src[i : j+1])
		}
		ok := r == '_' || r >= 0x80 || unicode.IsLetter(r) || (j > i+1 && unicode.IsDigit(r))
		if !ok {
			return ""
		}
		j++
	}
	return ""
}

func isBlank(chunk []rune) bool {
	i := 0
	for i < len(chunk) {
		switch {
		case isSpace(chunk[i]):
			i++
		case chunk[i] == '-' && peek(chunk, i+1) == '-':
			i = skipLineComment(chunk, i)
		case chunk[i] == '/' && peek(chunk, i+1) == '*':
			i = skipBlockComment(chunk, i)
		default:
			return false
		}
	}
	return true
}
