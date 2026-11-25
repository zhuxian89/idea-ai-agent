#!/usr/bin/env node
// jsxextract extract  <file> <Function> <startLine> <ComponentName> <outDir> <PropsType> <PropsFrom>
// jsxextract finalize <file> <Function>      add the imports of every component extracted so far
// jsxextract cleanup  <file> <Function>      drop destructured names the function no longer uses
//
// Cuts the JSX node that starts on <startLine> out of the component's return statement into its own
// component file. The JSX text moves unchanged. Values it reads are passed as:
//  * `xApi` objects  (variables the function got from hooks) typed `ReturnType<typeof useX>`, and
//  * `props`         (names destructured from the function's own props) typed as a Pick of <PropsType>.
// Run `extract` for subtrees from the bottom of the file upwards (their line numbers shift), then run
// `finalize` and `cleanup` once, then type check. Paths: file relative to runtime/web or absolute;
// <outDir> relative to runtime/web; <PropsFrom> is an import specifier as written in <file>.
const path = require('path');
const fs = require('fs');
const { webRoot, ts } = require('../lib/paths.cjs');
const PENDING = path.join(require('os').tmpdir(), 'jsxextract-pending.json');
const [cmd, fileArg, fnName, ...rest] = process.argv.slice(2);
const file = path.isAbsolute(fileArg) ? fileArg : path.join(webRoot, fileArg);
const fileRel = path.relative(webRoot, file);
function load() {
  const cfg = ts.readConfigFile(path.join(webRoot, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, webRoot);
  const program = ts.createProgram([file], parsed.options);
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(file);
  let fn = null; for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.name.text === fnName) fn = st;
  if (!fn) { console.error('function not found: ' + fnName); process.exit(1); }
  return { checker, sf, fn, text: sf.getFullText() };
}
const skipIdent = (n) => {
  const p = n.parent;
  return (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n) || (ts.isPropertyAssignment(p) && p.name === n)
    || (ts.isJsxAttribute(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n) || (ts.isPropertySignature(p) && p.name === n)
    || (ts.isMethodDeclaration(p) && p.name === n) || ts.isJsxClosingElement(p);
};
function pruneImports(newText) {
  const tmp = ts.createSourceFile('t.tsx', newText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const used = new Set();
  const collect = (n) => { if (ts.isIdentifier(n) && !(n.parent && (ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isNamespaceImport(n.parent)))) used.add(n.text); ts.forEachChild(n, collect); };
  tmp.statements.filter((s) => !ts.isImportDeclaration(s)).forEach(collect);
  const edits = [];
  for (const d of tmp.statements.filter(ts.isImportDeclaration)) {
    const c = d.importClause; if (!c) continue;
    const parts = []; let all = true;
    if (c.name) { if (used.has(c.name.text)) parts.push(c.name.text); else all = false; }
    const nb = c.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) { if (used.has(nb.name.text)) parts.push('* as ' + nb.name.text); else all = false; }
    if (nb && ts.isNamedImports(nb)) { const els = nb.elements.filter((e) => used.has(e.name.text)); if (els.length !== nb.elements.length) all = false; if (els.length) parts.push('{ ' + els.map((e) => e.getText()).join(', ') + ' }'); }
    if (all) continue;
    let repl = parts.length ? `import ${c.isTypeOnly ? 'type ' : ''}${parts.join(', ')} from ${d.moduleSpecifier.getText()};` : '';
    if (repl.length > 100) repl = repl.replace(/\{ ([^}]+) \}/, (m, g) => '{\n' + g.split(', ').map((x) => '  ' + x + ',').join('\n') + '\n}');
    const end = d.getEnd() + (!repl && newText[d.getEnd()] === '\n' ? 1 : 0);
    edits.push([d.getStart(), end, repl]);
  }
  edits.sort((a, b) => b[0] - a[0]);
  let out = newText; for (const [a, b, r] of edits) out = out.slice(0, a) + r + out.slice(b);
  return out;
}
const readPending = () => (fs.existsSync(PENDING) ? JSON.parse(fs.readFileSync(PENDING, 'utf8')) : []);

if (cmd === 'finalize') {
  const pend = readPending().filter((p) => p.file === fileRel);
  let t = fs.readFileSync(file, 'utf8');
  const tmp = ts.createSourceFile('t.tsx', t, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lastImp = tmp.statements.filter(ts.isImportDeclaration).pop();
  const add = pend.map((p) => `\nimport { ${p.name} } from "${p.rel.startsWith('.') ? p.rel : './' + p.rel}";`).join('');
  t = t.slice(0, lastImp.getEnd()) + add + t.slice(lastImp.getEnd());
  fs.writeFileSync(file, pruneImports(t));
  fs.writeFileSync(PENDING, JSON.stringify(readPending().filter((p) => p.file !== fileRel)));
  console.log('finalized imports for', pend.length, 'components');
  process.exit(0);
}
if (cmd === 'cleanup') {
  const { fn, text } = load();
  const used = new Set();
  const collect = (n) => { if (ts.isIdentifier(n) && !skipIdent(n)) used.add(n.text); ts.forEachChild(n, collect); };
  const destructures = fn.body.statements.filter((st) => ts.isVariableStatement(st) && st.declarationList.declarations.length === 1
    && ts.isObjectBindingPattern(st.declarationList.declarations[0].name) && st.declarationList.declarations[0].initializer && ts.isIdentifier(st.declarationList.declarations[0].initializer));
  for (const st of fn.body.statements) {
    if (destructures.includes(st)) { collect(st.declarationList.declarations[0].initializer); continue; }
    collect(st);
  }
  fn.parameters.forEach((p) => collect(p));
  const edits = [];
  for (const st of destructures) {
    const d = st.declarationList.declarations[0]; const els = d.name.elements;
    const keep = els.filter((e) => used.has(e.name.text));
    if (keep.length === els.length) continue;
    const a = st.getStart(), b = st.getEnd();
    // removing a whole statement must also remove the indentation in front of it, or it sticks to the next line
    let from = a; while (from > 0 && text[from - 1] === ' ') from--;
    if (!keep.length) edits.push([from, b + (text[b] === '\n' ? 1 : 0), '']);
    else edits.push([a, b, 'const { ' + keep.map((e) => e.getText()).join(', ') + ' } = ' + d.initializer.getText() + ';']);
  }
  edits.sort((x, y) => y[0] - x[0]);
  let out = text; for (const [a, b, r] of edits) out = out.slice(0, a) + r + out.slice(b);
  fs.writeFileSync(file, out);
  console.log('cleanup edits', edits.length);
  process.exit(0);
}
if (cmd !== 'extract') { console.error('usage: jsxextract extract|finalize|cleanup ...'); process.exit(2); }

const [startLineStr, compName, outDirRel, propsType, propsFromRel] = rest;
const startLine = +startLineStr;
const { checker, sf, fn, text } = load();
const outDir = path.join(webRoot, outDirRel);
const srcDir = path.dirname(file);
const ret = fn.body.statements.filter(ts.isReturnStatement).pop();
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
let target = null;
const find = (n) => {
  if ((ts.isJsxExpression(n) || ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) && lineOf(n.getStart()) === startLine && n !== ret.expression && !target) target = n;
  ts.forEachChild(n, find);
};
find(ret.expression);
if (!target) { console.error('no JSX node starts on line', startLine); process.exit(1); }
const imports = new Map();
for (const d of sf.statements.filter(ts.isImportDeclaration)) {
  const c = d.importClause; if (!c) continue; const spec = d.moduleSpecifier.text;
  if (c.name) imports.set(c.name.text, { d, spec, kind: 'default', text: c.name.text });
  const nb = c.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) imports.set(nb.name.text, { d, spec, kind: 'ns', text: '* as ' + nb.name.text });
  else if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) imports.set(e.name.text, { d, spec, kind: 'named', text: e.getText() });
}
const paramEls = new Map(); for (const e of fn.parameters[0].name.elements) paramEls.set(e.name.text, e);
const instOf = new Map(), instances = new Map();
const needImports = new Set(), propUses = new Set(), direct = new Set(), errors = [];
const inNode = (d) => d.getStart() >= target.getStart() && d.getEnd() <= target.getEnd();
const walk = (n) => {
  if (ts.isIdentifier(n) && !skipIdent(n)) {
    let sym = checker.getSymbolAtLocation(n);
    if (n.parent && ts.isShorthandPropertyAssignment(n.parent) && n.parent.name === n) sym = checker.getShorthandAssignmentValueSymbol(n.parent) || sym;
    if (sym && sym.declarations && sym.declarations.length) {
      const d = sym.declarations[0];
      if (!inNode(d)) {
        if (sym.flags & ts.SymbolFlags.Alias) { if (imports.has(n.text)) needImports.add(n.text); }
        else if (ts.isBindingElement(d) && paramEls.get(n.text) === d) propUses.add(n.text);
        else if (ts.isBindingElement(d) && d.parent.parent && ts.isVariableDeclaration(d.parent.parent) && fn.body.statements.includes(d.parent.parent.parent.parent) && d.parent.parent.initializer && ts.isIdentifier(d.parent.parent.initializer)) instOf.set(n.text, d.parent.parent.initializer.text);
        else if (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name) && d.initializer && ts.isCallExpression(d.initializer) && fn.body.statements.includes(d.parent.parent)) { direct.add(n.text); instances.set(n.text, { hook: d.initializer.expression.getText() }); }
        else if (d.getSourceFile() === sf && d.getStart() >= fn.getStart() && d.getEnd() <= fn.getEnd()) errors.push(`unsupported local '${n.text}' (${ts.SyntaxKind[d.kind]}) on line ${lineOf(d.getStart())}`);
        else if (d.getSourceFile() === sf && !(sym.flags & ts.SymbolFlags.Alias)) { if (imports.has(n.text)) needImports.add(n.text); else errors.push(`module level '${n.text}' is not supported`); }
      }
    }
  }
  ts.forEachChild(n, walk);
};
walk(target);
for (const inst of new Set(instOf.values())) {
  if (instances.has(inst)) continue;
  const st = fn.body.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations[0].name.getText() === inst);
  if (!st) { errors.push('no declaration for ' + inst); continue; }
  instances.set(inst, { hook: st.declarationList.declarations[0].initializer.expression.getText() });
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
const byInst = new Map(); for (const [n, inst] of instOf) { if (!byInst.has(inst)) byInst.set(inst, new Set()); byInst.get(inst).add(n); }
const allInst = [...new Set([...byInst.keys(), ...direct])].sort();
const relSpec = (spec, fromDir) => { if (!spec.startsWith('.')) return spec; const r = path.relative(fromDir, path.resolve(srcDir, spec)).split(path.sep).join('/'); return r.startsWith('.') ? r : './' + r; };
const lines = [];
const byMod = new Map();
for (const n of needImports) {
  const im = imports.get(n); const sp = relSpec(im.spec, outDir); const key = sp + '|' + (im.d.importClause.isTypeOnly ? 't' : '');
  if (!byMod.has(key)) byMod.set(key, { sp, t: im.d.importClause.isTypeOnly, def: null, ns: null, named: [] });
  const m = byMod.get(key); if (im.kind === 'default') m.def = im.text; else if (im.kind === 'ns') m.ns = im.text; else m.named.push(im.text);
}
for (const m of byMod.values()) {
  const parts = []; if (m.def) parts.push(m.def); if (m.ns) parts.push(m.ns); if (m.named.length) parts.push('{ ' + m.named.join(', ') + ' }');
  let l = `import ${m.t ? 'type ' : ''}${parts.join(', ')} from "${m.sp}";`;
  if (l.length > 100 && m.named.length) l = `import ${m.t ? 'type ' : ''}${[...(m.def ? [m.def] : []), ...(m.ns ? [m.ns] : []), '{\n' + m.named.map((x) => '  ' + x + ',').join('\n') + '\n}'].join(', ')} from "${m.sp}";`;
  lines.push(l);
}
for (const inst of allInst) { const hook = instances.get(inst).hook; const im = imports.get(hook); lines.push(`import type { ${hook} } from "${relSpec(im.spec, outDir)}";`); }
const pn = [...propUses].sort();
if (pn.length) lines.push(`import type { ${propsType} } from "${relSpec(propsFromRel, outDir)}";`);
const fields = allInst.map((i) => `  ${i}: ReturnType<typeof ${instances.get(i).hook}>;`);
if (pn.length) {
  const plain = pn.filter((x) => !paramEls.get(x).initializer), def = pn.filter((x) => paramEls.get(x).initializer);
  const parts = [];
  if (plain.length) parts.push(`Pick<${propsType}, ${plain.map((x) => JSON.stringify(x)).join(' | ')}>`);
  if (def.length) parts.push(`Required<Pick<${propsType}, ${def.map((x) => JSON.stringify(x)).join(' | ')}>>`);
  fields.push(`  props: ${parts.join(' & ')};`);
}
const params = [...allInst, ...(pn.length ? ['props'] : [])];
let bodyText = '';
for (const inst of [...byInst.keys()].sort()) bodyText += `  const { ${[...byInst.get(inst)].sort().join(', ')} } = ${inst};\n`;
if (pn.length) bodyText += `  const { ${pn.join(', ')} } = props;\n`;
const exprNode = ts.isJsxExpression(target) ? target.expression : target;
let jsxText = exprNode.getText();
{
  const ls = jsxText.split('\n');
  const restLines = ls.slice(1).filter((l) => l.trim());
  const minIndent = restLines.length ? Math.min(...restLines.map((l) => l.match(/^ */)[0].length)) : 0;
  const base = ts.isJsxExpression(target) ? 6 : 4;
  const delta = minIndent - base;
  jsxText = ls.map((l, i) => (i === 0 || !l.trim() ? l : (delta >= 0 ? l.slice(Math.min(delta, l.match(/^ */)[0].length)) : ' '.repeat(-delta) + l))).join('\n');
}
const out = `${lines.join('\n')}\n\ntype Deps = {\n${fields.join('\n')}\n};\n\nexport function ${compName}({ ${params.join(', ')} }: Deps) {\n${bodyText}  return (\n    ${jsxText}\n  );\n}\n`;
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, compName + '.tsx'), out);
const attrs = allInst.map((i) => `${i}={${i}}`);
if (pn.length) attrs.push(`props={{ ${pn.join(', ')} }}`);
fs.writeFileSync(file, text.slice(0, target.getStart()) + `<${compName} ${attrs.join(' ')} />` + text.slice(target.getEnd()));
const pend = readPending();
pend.push({ file: fileRel, name: compName, rel: path.relative(srcDir, path.join(outDir, compName)).split(path.sep).join('/') });
fs.writeFileSync(PENDING, JSON.stringify(pend));
console.log(`extracted ${compName}: ${lineOf(target.getEnd()) - lineOf(target.getStart()) + 1} lines; hooks=${allInst.join(',') || '-'} props=${pn.length}`);
