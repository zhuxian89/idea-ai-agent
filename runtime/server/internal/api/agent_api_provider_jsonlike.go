package api

import (
	"regexp"
	"strings"
)

func normalizeJSONLikeConfig(input string) string {
	text := stripJSONLikeComments(input)
	text = replaceSingleQuotedStrings(text)
	text = quoteJSONLikeKeys(text)
	text = removeJSONTrailingCommas(text)
	return text
}

func stripJSONLikeComments(input string) string {
	var b strings.Builder
	inString := false
	quote := rune(0)
	escaped := false
	for i := 0; i < len(input); i++ {
		ch := rune(input[i])
		if inString {
			b.WriteByte(input[i])
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == quote {
				inString = false
			}
			continue
		}
		if ch == '"' || ch == '\'' {
			inString = true
			quote = ch
			b.WriteByte(input[i])
			continue
		}
		if ch == '/' && i+1 < len(input) && input[i+1] == '/' {
			for i < len(input) && input[i] != '\n' {
				i++
			}
			if i < len(input) {
				b.WriteByte(input[i])
			}
			continue
		}
		if ch == '/' && i+1 < len(input) && input[i+1] == '*' {
			i += 2
			for i+1 < len(input) && !(input[i] == '*' && input[i+1] == '/') {
				i++
			}
			i++
			continue
		}
		b.WriteByte(input[i])
	}
	return b.String()
}

func replaceSingleQuotedStrings(input string) string {
	var b strings.Builder
	inSingle := false
	inDouble := false
	escaped := false
	for i := 0; i < len(input); i++ {
		ch := input[i]
		if inDouble {
			b.WriteByte(ch)
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inDouble = false
			}
			continue
		}
		if !inSingle {
			if ch == '"' {
				inDouble = true
				b.WriteByte(ch)
				continue
			}
			if ch == '\'' {
				inSingle = true
				b.WriteByte('"')
				continue
			}
			b.WriteByte(ch)
			continue
		}
		if escaped {
			if ch == '\'' {
				b.WriteByte('\'')
			} else {
				b.WriteByte('\\')
				b.WriteByte(ch)
			}
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '"' {
			b.WriteString(`\"`)
			continue
		}
		if ch == '\'' {
			inSingle = false
			b.WriteByte('"')
			continue
		}
		b.WriteByte(ch)
	}
	return b.String()
}

func quoteJSONLikeKeys(input string) string {
	re := regexp.MustCompile(`([,{]\s*)([A-Za-z_$][A-Za-z0-9_$-]*)(\s*:)`)
	prev := ""
	out := input
	for out != prev {
		prev = out
		out = re.ReplaceAllString(out, `$1"$2"$3`)
	}
	return out
}

func removeJSONTrailingCommas(input string) string {
	re := regexp.MustCompile(`,\s*([}\]])`)
	prev := ""
	out := input
	for out != prev {
		prev = out
		out = re.ReplaceAllString(out, `$1`)
	}
	return out
}
