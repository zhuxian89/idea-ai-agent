#!/usr/bin/env node
// tsmove <src> <dst> <name>...   move top-level declarations from src into a new file dst of the same
// directory. Declaration text (with its leading comments) moves unchanged and gains `export`; src imports
// the names it still uses and re-exports the ones other files imported from it, so no caller changes.
// Imports in both files are recomputed from usage.
const path = require('path');
const fs = require('fs');
const { ts } = require('../lib/paths.cjs');
const [srcArg, dstArg, ...names] = process.argv.slice(2);
if (!srcArg || !dstArg || !names.length) { console.error('usage: tsmove <src> <dst> <name>...'); process.exit(2); }
const src = path.resolve(srcArg), dst = path.resolve(dstArg);
if (fs.existsSync(dst)) { console.error(dst + ' already exists'); process.exit(1); }
const want = new Set(names);
const text = fs.readFileSync(src, 'utf8');
const kind = src.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
const sf = ts.createSourceFile(src, text, ts.ScriptTarget.Latest, true, kind);
const declNames = (st) => {
  if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) return st.name ? [st.name.text] : [];
  if (ts.isVariableStatement(st)) return st.declarationList.declarations.map((d) => d.name.getText());
  return null;
};
const isExported = (st) => (st.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
const imports = [], moved = [], keptTop = new Set(), found = new Set();
for (const st of sf.statements) {
  if (ts.isImportDeclaration(st)) { imports.push(st); continue; }
  const ns = declNames(st);
  if (!ns) continue;
  const hit = ns.filter((n) => want.has(n));
  if (!hit.length) { ns.forEach((n) => keptTop.add(n)); continue; }
  if (hit.length !== ns.length) { console.error('cannot split one statement declaring: ' + ns.join(', ')); process.exit(1); }
  hit.forEach((n) => found.add(n));
  moved.push({ st, names: ns, isType: ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st), start: st.getFullStart(), end: st.getEnd(), exported: isExported(st) });
}
for (const n of want) if (!found.has(n)) { console.error('not found: ' + n); process.exit(1); }
const idents = (node) => { const s = new Set(); const walk = (n) => { if (ts.isIdentifier(n)) s.add(n.text); ts.forEachChild(n, walk); }; walk(node); return s; };
const movedTexts = moved.map((m) => { let t = text.slice(m.start, m.end).replace(/^\s+/, ''); return m.exported ? t : 'export ' + t; });
const movedIdents = new Set(); moved.forEach((m) => idents(m.st).forEach((i) => movedIdents.add(i)));
const needs = [...keptTop].filter((n) => movedIdents.has(n) && !want.has(n));
if (needs.length) console.error('NOTE: moved code uses declarations that stay behind (circular import risk): ' + needs.join(', '));
const importText = (imp, keep) => {
  const clause = imp.importClause; if (!clause) return null;
  const spec = imp.moduleSpecifier.getText();
  const def = clause.name && keep(clause.name.text) ? [clause.name.text] : [];
  const nb = clause.namedBindings; let ns = [], named = [];
  if (nb && ts.isNamespaceImport(nb) && keep(nb.name.text)) ns = ['* as ' + nb.name.text];
  else if (nb && ts.isNamedImports(nb)) { const els = nb.elements.filter((e) => keep(e.name.text)).map((e) => e.getText()); if (els.length) named = ['{ ' + els.join(', ') + ' }']; }
  const parts = [...def, ...ns, ...named];
  return parts.length ? `import ${clause.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from ${spec};` : null;
};
const newImports = imports.map((i) => importText(i, (n) => movedIdents.has(n))).filter(Boolean);
let rest = text;
for (const m of [...moved].sort((a, b) => b.start - a.start)) rest = rest.slice(0, m.start) + rest.slice(m.end);
rest = rest.replace(/\n{3,}/g, '\n\n');
const restSf = ts.createSourceFile(src, rest, ts.ScriptTarget.Latest, true, kind);
const restIdents = new Set(); restSf.statements.filter((s) => !ts.isImportDeclaration(s)).forEach((s) => idents(s).forEach((i) => restIdents.add(i)));
const movedNames = moved.flatMap((m) => m.names);
const backImports = movedNames.filter((n) => restIdents.has(n));
let out = rest;
const edits = restSf.statements.filter(ts.isImportDeclaration).filter((i) => i.importClause)
  .map((imp) => [imp.getStart(), imp.getEnd(), importText(imp, (n) => restIdents.has(n))]).sort((a, b) => b[0] - a[0]);
for (const [a, b, t] of edits) out = out.slice(0, a) + (t === null ? '' : t) + out.slice(b);
const dstBase = './' + path.basename(dst).replace(/\.(tsx|ts)$/, '');
const outSf = ts.createSourceFile(src, out, ts.ScriptTarget.Latest, true, kind);
const imps = outSf.statements.filter(ts.isImportDeclaration);
const lastImportEnd = imps.length ? imps[imps.length - 1].getEnd() : 0;
const add = [];
if (backImports.length) add.push(`import { ${backImports.join(', ')} } from "${dstBase}";`);
const expValues = moved.filter((m) => m.exported && !m.isType).flatMap((m) => m.names);
const expTypes = moved.filter((m) => m.exported && m.isType).flatMap((m) => m.names);
if (expValues.length) add.push(`export { ${expValues.join(', ')} } from "${dstBase}";`);
if (expTypes.length) add.push(`export type { ${expTypes.join(', ')} } from "${dstBase}";`);
out = (out.slice(0, lastImportEnd) + (add.length ? '\n' + add.join('\n') : '') + out.slice(lastImportEnd)).replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(src, out);
fs.writeFileSync(dst, (newImports.length ? newImports.join('\n') + '\n\n' : '') + movedTexts.join('\n\n') + '\n');
console.log(`moved ${moved.length} statements (${movedNames.join(', ')}) -> ${path.relative(process.cwd(), dst)}`);
