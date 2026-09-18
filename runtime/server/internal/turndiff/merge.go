package turndiff

import (
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

func cleanDiffPaths(diff string) string {
	lines := strings.Split(diff, "\n")
	header := false
	for i, line := range lines {
		if strings.HasPrefix(line, "diff --git ") {
			header = true
			left, right := temporaryPair(strings.TrimPrefix(line, "diff --git "), " ")
			if left != "" {
				lines[i] = "diff --git " + left + " " + right
			}
			continue
		}
		if strings.HasPrefix(line, "@@") {
			header = false
		}
		if !header {
			continue
		}
		switch {
		case strings.HasPrefix(line, "--- "), strings.HasPrefix(line, "+++ "):
			line = line[:4] + cleanTemporaryRef(line[4:])
		case strings.HasPrefix(line, "Binary files "):
			left, right := temporaryPair(strings.TrimSuffix(strings.TrimPrefix(line, "Binary files "), " differ"), " and ")
			if left != "" {
				line = "Binary files " + left + " and " + right + " differ"
			}
		}
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

// Remove exactly one temporary directory component, preserving quoting and
// actual filenames containing spaces or directories called before/after.
func cleanTemporaryRef(ref string) string {
	for _, quote := range []string{"", "\""} {
		for _, side := range []string{"a/", "b/"} {
			for _, dir := range []string{"before/", "after/"} {
				if strings.HasPrefix(ref, quote+side+dir) {
					return quote + side + strings.TrimPrefix(ref, quote+side+dir)
				}
			}
		}
	}
	return ref
}

func temporaryPair(rest, separator string) (string, string) {
	for offset := 0; offset < len(rest); {
		i := strings.Index(rest[offset:], separator)
		if i < 0 {
			break
		}
		i += offset
		left, right := cleanTemporaryRef(rest[:i]), cleanTemporaryRef(rest[i+len(separator):])
		l, r := stripSide(unquote(left)), stripSide(unquote(right))
		if l == r || l == "/dev/null" || r == "/dev/null" {
			return left, right
		}
		offset = i + len(separator)
	}
	return "", ""
}

// Merge replaces only native sections whose complete before/after state was
// observed. This covers mixed native + command edits to the SAME file and
// drops changes reverted before turn end. Native-only/uncaptured files survive.
// The original native event itself is never mutated.
func (r *Result) Merge(native string) string {
	var retained strings.Builder
	for _, section := range sections(native) {
		paths := sectionPaths(section)
		covered := len(paths) > 0
		for _, path := range paths {
			if r.covered[path] {
				continue
			}
			if filepath.IsAbs(path) {
				if rel, err := filepath.Rel(r.root, path); err == nil {
					path = filepath.ToSlash(rel)
				}
			}
			covered = covered && r.covered[path]
		}
		if !covered {
			retained.WriteString(strings.TrimRight(section, "\n"))
			retained.WriteByte('\n')
		}
	}
	retained.WriteString(r.Diff)
	return retained.String()
}

// MapPaths expresses runtime-worktree paths in the managed project's coordinate
// system, so the displayed files still open in the correct IDEA editor.
func (r *Result) MapPaths(mapper func(string) string) {
	covered := make(map[string]bool, len(r.covered))
	for path := range r.covered {
		covered[mapper(path)] = true
	}
	r.covered = covered
	if r.changed != nil {
		changed := make(map[string]ChangedFile, len(r.changed))
		for path, value := range r.changed {
			value.Path = mapper(path)
			changed[value.Path] = value
		}
		r.changed = changed
	}
	var diff strings.Builder
	for _, section := range sections(r.Diff) {
		paths := sectionPaths(section)
		if len(paths) == 0 {
			diff.WriteString(section)
			continue
		}
		path := mapper(paths[0])
		if path == paths[0] {
			diff.WriteString(section)
			if !strings.HasSuffix(section, "\n") {
				diff.WriteByte('\n')
			}
			continue
		}
		left, right := quotePath("a/"+path), quotePath("b/"+path)
		lines := strings.Split(strings.TrimRight(section, "\n"), "\n")
		for i, line := range lines {
			if strings.HasPrefix(line, "@@") {
				break
			}
			switch {
			case strings.HasPrefix(line, "diff --git "):
				lines[i] = "diff --git " + left + " " + right
			case strings.HasPrefix(line, "--- ") && line != "--- /dev/null":
				lines[i] = "--- " + left
			case strings.HasPrefix(line, "+++ ") && line != "+++ /dev/null":
				lines[i] = "+++ " + right
			case strings.HasPrefix(line, "Binary files "):
				binaryLeft, binaryRight := left, right
				if strings.HasPrefix(line, "Binary files /dev/null ") {
					binaryLeft = "/dev/null"
				}
				if strings.HasSuffix(line, " and /dev/null differ") {
					binaryRight = "/dev/null"
				}
				lines[i] = "Binary files " + binaryLeft + " and " + binaryRight + " differ"
			}
		}
		diff.WriteString(strings.Join(lines, "\n") + "\n")
	}
	r.Diff = diff.String()
}

func quotePath(path string) string {
	var out strings.Builder
	out.WriteByte('"')
	for _, b := range []byte(path) {
		switch {
		case b == '\\' || b == '"':
			out.WriteByte('\\')
			out.WriteByte(b)
		case b < 32 || b >= 127:
			fmt.Fprintf(&out, "\\%03o", b)
		default:
			out.WriteByte(b)
		}
	}
	out.WriteByte('"')
	return out.String()
}

func sections(diff string) []string {
	if strings.TrimSpace(diff) == "" {
		return nil
	}
	parts := strings.Split(diff, "\ndiff --git ")
	for i := 1; i < len(parts); i++ {
		parts[i] = "diff --git " + parts[i]
	}
	return parts
}

func sectionPaths(section string) []string {
	paths := []string{}
	for _, line := range strings.Split(section, "\n") {
		if strings.HasPrefix(line, "@@") {
			break
		}
		for _, prefix := range []string{"--- ", "+++ ", "rename from ", "rename to "} {
			if !strings.HasPrefix(line, prefix) {
				continue
			}
			name := strings.TrimPrefix(line, prefix)
			name, _, _ = strings.Cut(name, "\t")
			name = unquote(name)
			if name == "/dev/null" {
				continue
			}
			if prefix == "--- " || prefix == "+++ " {
				name = stripSide(name)
			}
			paths = append(paths, name)
		}
	}
	if len(paths) > 0 {
		return paths
	}
	// Binary / empty / mode-only changes have only the diff --git header.
	line, _, _ := strings.Cut(section, "\n")
	rest := strings.TrimPrefix(line, "diff --git ")
	if rest == line {
		return nil
	}
	if strings.HasPrefix(rest, "\"") {
		for i := 1; i < len(rest); i++ {
			if rest[i] == '\\' {
				i++
				continue
			}
			if rest[i] == '"' {
				return []string{stripSide(unquote(rest[:i+1])), stripSide(unquote(strings.TrimSpace(rest[i+1:])))}
			}
		}
	}
	for offset := 0; offset < len(rest); {
		i := strings.Index(rest[offset:], " b/")
		if i < 0 {
			break
		}
		i += offset
		left, right := stripSide(rest[:i]), stripSide(rest[i+1:])
		if left == right {
			return []string{left}
		}
		offset = i + 1
	}
	return nil
}

func stripSide(path string) string {
	if strings.HasPrefix(path, "a/") || strings.HasPrefix(path, "b/") {
		return path[2:]
	}
	return path
}

func unquote(path string) string {
	if strings.HasPrefix(path, "\"") {
		if value, err := strconv.Unquote(path); err == nil {
			return value
		}
	}
	return path
}
