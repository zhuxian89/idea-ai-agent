#!/usr/bin/env node
// pruneimports <file.ts|tsx>...   remove imported names the file no longer uses (side-effect imports stay).
// Moving code between files leaves unused imports behind; the project does not enable noUnusedLocals.
const path = require('path');
const fs = require('fs');
const { ts } = require('../lib/paths.cjs');
for (const arg of process.argv.slice(2)) {
  const file = path.resolve(arg);
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const used = new Set();
  const collect = (n) => { if (ts.isIdentifier(n) && !(n.parent && (ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isNamespaceImport(n.parent)))) used.add(n.text); ts.forEachChild(n, collect); };
  sf.statements.filter((s) => !ts.isImportDeclaration(s)).forEach(collect);
  const edits = [];
  for (const d of sf.statements.filter(ts.isImportDeclaration)) {
    const c = d.importClause; if (!c) continue;
    const parts = []; let all = true;
    if (c.name) { if (used.has(c.name.text)) parts.push(c.name.text); else all = false; }
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) { if (used.has(nb.name.text)) parts.push('* as ' + nb.name.text); else all = false; }
    if (nb && ts.isNamedImports(nb)) { const els = nb.elements.filter((e) => used.has(e.name.text)); if (els.length !== nb.elements.length) all = false; if (els.length) parts.push('{ ' + els.map((e) => e.getText()).join(', ') + ' }'); }
    if (all) continue;
    let repl = parts.length ? `import ${c.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from ${d.moduleSpecifier.getText()};` : '';
    if (repl.length > 100) repl = repl.replace(/\{ ([^}]+) \}/, (m, g) => '{\n' + g.split(', ').map((x) => '  ' + x + ',').join('\n') + '\n}');
    edits.push([d.getStart(), d.getEnd() + (!repl && text[d.getEnd()] === '\n' ? 1 : 0), repl]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let out = text; for (const [a, b, r] of edits) out = out.slice(0, a) + r + out.slice(b);
  if (out !== text) fs.writeFileSync(file, out);
  console.log(`${path.relative(process.cwd(), file)}: ${edits.length} import(s) pruned`);
}
