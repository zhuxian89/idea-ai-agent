#!/usr/bin/env node
// relocate <from> <to>   move a file to another directory and rewrite its own relative import / export-from
// specifiers so they still resolve. Importers of the file are NOT updated; use it for new, unreferenced files.
const path = require('path');
const fs = require('fs');
const { ts } = require('../lib/paths.cjs');
const [fromArg, toArg] = process.argv.slice(2);
const from = path.resolve(fromArg), to = path.resolve(toArg);
if (fs.existsSync(to)) { console.error(to + ' already exists'); process.exit(1); }
const text = fs.readFileSync(from, 'utf8');
const sf = ts.createSourceFile(from, text, ts.ScriptTarget.Latest, true, from.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const edits = [];
for (const st of sf.statements) {
  const spec = (ts.isImportDeclaration(st) || (ts.isExportDeclaration(st) && st.moduleSpecifier)) ? st.moduleSpecifier : null;
  if (!spec || !spec.text.startsWith('.')) continue;
  let r = path.relative(path.dirname(to), path.resolve(path.dirname(from), spec.text)).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  edits.push([spec.getStart(), spec.getEnd(), JSON.stringify(r)]);
}
edits.sort((a, b) => b[0] - a[0]);
let out = text; for (const [a, b, r] of edits) out = out.slice(0, a) + r + out.slice(b);
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, out);
fs.unlinkSync(from);
console.log(`${path.relative(process.cwd(), from)} -> ${path.relative(process.cwd(), to)} (${edits.length} specifiers rewritten)`);
