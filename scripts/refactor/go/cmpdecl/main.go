// cmpdecl proves that a refactoring of Go packages only moved code around.
//
//	cmpdecl <baseRoot> <workRoot> <package dir>...
//
// For every package directory (relative to both roots) it compares the top-level declarations of all
// non-test files: each declaration must exist on both sides with identical printed source, and the
// multiset of non-import source lines must be the same. Exit status 1 means a difference was found.
//
// Typical use: export the pre-refactor tree with `git archive HEAD runtime | tar -x -C /tmp/base`,
// then compare it against the working tree.
package main

import (
	"bytes"
	"fmt"
	"go/ast"
	"go/parser"
	"go/printer"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func collect(dir string) (map[string][]string, map[string]int, error) {
	decls := map[string][]string{}
	lines := map[string]int{}
	files, _ := filepath.Glob(filepath.Join(dir, "*.go"))
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			return nil, nil, err
		}
		inImport := false
		for _, l := range strings.Split(string(src), "\n") {
			t := strings.TrimSpace(l)
			if strings.HasPrefix(t, "import (") {
				inImport = true
				continue
			}
			if inImport {
				if t == ")" {
					inImport = false
				}
				continue
			}
			if t == "" || strings.HasPrefix(t, "package ") || strings.HasPrefix(t, "import ") {
				continue
			}
			lines[t]++
		}
		fset := token.NewFileSet()
		af, err := parser.ParseFile(fset, f, src, parser.ParseComments)
		if err != nil {
			return nil, nil, err
		}
		for _, d := range af.Decls {
			var key string
			switch x := d.(type) {
			case *ast.FuncDecl:
				recv := ""
				if x.Recv != nil && len(x.Recv.List) > 0 {
					var b bytes.Buffer
					printer.Fprint(&b, fset, x.Recv.List[0].Type)
					recv = b.String()
				}
				key = "func " + recv + "." + x.Name.Name
			case *ast.GenDecl:
				if x.Tok == token.IMPORT {
					continue
				}
				var names []string
				for _, s := range x.Specs {
					switch sp := s.(type) {
					case *ast.TypeSpec:
						names = append(names, sp.Name.Name)
					case *ast.ValueSpec:
						for _, n := range sp.Names {
							names = append(names, n.Name)
						}
					}
				}
				key = x.Tok.String() + " " + strings.Join(names, ",")
			}
			var b bytes.Buffer
			printer.Fprint(&b, fset, d)
			decls[key] = append(decls[key], b.String())
		}
	}
	return decls, lines, nil
}

func main() {
	if len(os.Args) < 4 {
		fmt.Fprintln(os.Stderr, "usage: cmpdecl <baseRoot> <workRoot> <package dir>...")
		os.Exit(2)
	}
	base, work := os.Args[1], os.Args[2]
	bad := false
	for _, pkg := range os.Args[3:] {
		a, al, err := collect(filepath.Join(base, pkg))
		if err != nil {
			fmt.Println(pkg, "base:", err)
			bad = true
			continue
		}
		b, bl, err := collect(filepath.Join(work, pkg))
		if err != nil {
			fmt.Println(pkg, "work:", err)
			bad = true
			continue
		}
		var issues []string
		for k, av := range a {
			bv, ok := b[k]
			if !ok {
				issues = append(issues, "MISSING "+k)
				continue
			}
			if len(av) != len(bv) {
				issues = append(issues, "COUNT "+k)
				continue
			}
			sort.Strings(av)
			sort.Strings(bv)
			for i := range av {
				if av[i] != bv[i] {
					issues = append(issues, "CHANGED "+k)
					break
				}
			}
		}
		for k := range b {
			if _, ok := a[k]; !ok {
				issues = append(issues, "ADDED "+k)
			}
		}
		lineDiffs := 0
		for l, c := range al {
			if bl[l] != c {
				lineDiffs++
			}
		}
		for l := range bl {
			if _, ok := al[l]; !ok {
				lineDiffs++
			}
		}
		sort.Strings(issues)
		status := "OK"
		if len(issues) > 0 || lineDiffs > 0 {
			status = "DIFF"
			bad = true
		}
		fmt.Printf("%s %s: declarations %d->%d, declaration issues=%d, line differences=%d\n", status, pkg, len(a), len(b), len(issues), lineDiffs)
		for _, s := range issues {
			fmt.Println("   ", s)
		}
	}
	if bad {
		os.Exit(1)
	}
}
