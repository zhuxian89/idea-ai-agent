// gosplit moves top-level declarations (with their doc comments) from one Go file into a new file
// of the same package. Declaration text is moved byte for byte; imports are recomputed from usage.
//
//	gosplit <src.go> <new.go> <selector>...
//
// A selector is one of:
//
//	Name          a function, type, var or const
//	Type.Method   a method
//	lines:A-B     every declaration whose first line (doc comment included) is in A..B
//
// Line ranges refer to the source file as it is when the command starts. After a move the line
// numbers of the source file shift, so run several moves from the bottom of the file upwards.
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strconv"
	"strings"
)

type span struct{ start, end int }

type lineRange struct{ lo, hi int }

func fail(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "gosplit: "+format+"\n", args...)
	os.Exit(1)
}

func declKeys(d ast.Decl) []string {
	switch x := d.(type) {
	case *ast.FuncDecl:
		if x.Recv != nil && len(x.Recv.List) > 0 {
			t := x.Recv.List[0].Type
			if s, ok := t.(*ast.StarExpr); ok {
				t = s.X
			}
			if ix, ok := t.(*ast.IndexExpr); ok {
				t = ix.X
			}
			if id, ok := t.(*ast.Ident); ok {
				return []string{id.Name + "." + x.Name.Name}
			}
		}
		return []string{x.Name.Name}
	case *ast.GenDecl:
		var keys []string
		for _, s := range x.Specs {
			switch sp := s.(type) {
			case *ast.TypeSpec:
				keys = append(keys, sp.Name.Name)
			case *ast.ValueSpec:
				for _, n := range sp.Names {
					keys = append(keys, n.Name)
				}
			}
		}
		return keys
	}
	return nil
}

func docOf(d ast.Decl) *ast.CommentGroup {
	switch x := d.(type) {
	case *ast.FuncDecl:
		return x.Doc
	case *ast.GenDecl:
		return x.Doc
	}
	return nil
}

// usedPackages lists identifiers that are used as the left side of a selector and are not
// declared in the file, which is how imported package names look to the parser.
func usedPackages(nodes []ast.Node) map[string]bool {
	used := map[string]bool{}
	for _, n := range nodes {
		ast.Inspect(n, func(x ast.Node) bool {
			if se, ok := x.(*ast.SelectorExpr); ok {
				if id, ok := se.X.(*ast.Ident); ok && id.Obj == nil {
					used[id.Name] = true
				}
			}
			return true
		})
	}
	return used
}

func importName(is *ast.ImportSpec) string {
	if is.Name != nil {
		return is.Name.Name
	}
	p, _ := strconv.Unquote(is.Path.Value)
	parts := strings.Split(p, "/")
	last := parts[len(parts)-1]
	if len(parts) > 1 && strings.HasPrefix(last, "v") && len(last) <= 3 {
		if _, err := strconv.Atoi(last[1:]); err == nil {
			last = parts[len(parts)-2]
		}
	}
	if i := strings.Index(last, ".v"); i > 0 { // gopkg.in/yaml.v3
		last = last[:i]
	}
	return strings.ReplaceAll(last, "-", "_")
}

// render writes header (anything before the package clause, such as build constraints), the
// package clause, the imports that body still needs, and body.
func render(header, pkg string, imports []*ast.ImportSpec, used map[string]bool, body string) []byte {
	var b bytes.Buffer
	b.WriteString(header)
	b.WriteString("package " + pkg + "\n\n")
	var lines []string
	for _, is := range imports {
		n := importName(is)
		explicit := is.Name != nil
		if explicit && (n == "_" || n == ".") {
			lines = append(lines, "\t"+n+" "+is.Path.Value)
			continue
		}
		if !used[n] {
			continue
		}
		if explicit {
			lines = append(lines, "\t"+n+" "+is.Path.Value)
		} else {
			lines = append(lines, "\t"+is.Path.Value)
		}
	}
	if len(lines) > 0 {
		b.WriteString("import (\n" + strings.Join(lines, "\n") + "\n)\n\n")
	}
	b.WriteString(strings.TrimLeft(body, "\n"))
	out, err := format.Source(b.Bytes())
	if err != nil {
		fail("formatting generated code: %v", err)
	}
	return out
}

func main() {
	if len(os.Args) < 4 {
		fail("usage: gosplit <src.go> <new.go> <selector>...")
	}
	srcPath, newPath := os.Args[1], os.Args[2]
	if _, err := os.Stat(newPath); err == nil {
		fail("%s already exists", newPath)
	}
	want := map[string]bool{}
	var ranges []lineRange
	for _, sel := range os.Args[3:] {
		if strings.HasPrefix(sel, "lines:") {
			parts := strings.Split(strings.TrimPrefix(sel, "lines:"), "-")
			if len(parts) != 2 {
				fail("bad range %q", sel)
			}
			lo, e1 := strconv.Atoi(parts[0])
			hi, e2 := strconv.Atoi(parts[1])
			if e1 != nil || e2 != nil {
				fail("bad range %q", sel)
			}
			ranges = append(ranges, lineRange{lo, hi})
			continue
		}
		want[sel] = true
	}
	src, err := os.ReadFile(srcPath)
	if err != nil {
		fail("%v", err)
	}
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, srcPath, src, parser.ParseComments)
	if err != nil {
		fail("%v", err)
	}
	var moved []ast.Node
	var spans []span
	found := map[string]bool{}
	for _, d := range f.Decls {
		if g, ok := d.(*ast.GenDecl); ok && g.Tok == token.IMPORT {
			continue
		}
		keys := declKeys(d)
		if len(keys) == 0 {
			continue
		}
		all := true
		for _, k := range keys {
			if want[k] {
				found[k] = true
			} else {
				all = false
			}
		}
		start := fset.Position(d.Pos()).Offset
		line := fset.Position(d.Pos()).Line
		if doc := docOf(d); doc != nil {
			start = fset.Position(doc.Pos()).Offset
			line = fset.Position(doc.Pos()).Line
		}
		for _, r := range ranges {
			if line >= r.lo && line <= r.hi {
				all = true
			}
		}
		if all {
			moved = append(moved, d)
			spans = append(spans, span{start, fset.Position(d.End()).Offset})
		}
	}
	for k := range want {
		if !found[k] {
			fail("declaration %q not found", k)
		}
	}
	if len(spans) == 0 {
		fail("nothing selected")
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	var movedBody bytes.Buffer
	var remaining []byte
	prev := 0
	for _, s := range spans {
		movedBody.Write(src[s.start:s.end])
		movedBody.WriteString("\n\n")
		remaining = append(remaining, src[prev:s.start]...)
		prev = s.end
	}
	remaining = append(remaining, src[prev:]...)

	var imports []*ast.ImportSpec
	for _, d := range f.Decls {
		if g, ok := d.(*ast.GenDecl); ok && g.Tok == token.IMPORT {
			for _, s := range g.Specs {
				imports = append(imports, s.(*ast.ImportSpec))
			}
		}
	}
	pkgPos := fset.Position(f.Package).Offset
	header := string(src[:pkgPos])

	// Rebuild the source file: reparse what is left, drop its import block and regenerate it.
	fset2 := token.NewFileSet()
	rf, err := parser.ParseFile(fset2, srcPath, remaining, parser.ParseComments)
	if err != nil {
		fail("reparsing remaining code: %v", err)
	}
	impStart, impEnd := -1, -1
	var rest []ast.Node
	for _, d := range rf.Decls {
		if g, ok := d.(*ast.GenDecl); ok && g.Tok == token.IMPORT {
			if impStart < 0 {
				impStart = fset2.Position(g.Pos()).Offset
			}
			impEnd = fset2.Position(g.End()).Offset
			continue
		}
		rest = append(rest, d)
	}
	body := string(remaining)
	if impStart >= 0 {
		body = body[:impStart] + body[impEnd:]
	}
	pkgIdx := strings.Index(body, "package ")
	nl := strings.Index(body[pkgIdx:], "\n")
	body = body[pkgIdx+nl:]

	newOut := render(header, f.Name.Name, imports, usedPackages(moved), movedBody.String())
	srcOut := render(header, f.Name.Name, imports, usedPackages(rest), body)
	if err := os.WriteFile(newPath, newOut, 0o644); err != nil {
		fail("%v", err)
	}
	if err := os.WriteFile(srcPath, srcOut, 0o644); err != nil {
		fail("%v", err)
	}
	fmt.Printf("moved %d declarations -> %s\n", len(moved), newPath)
}
