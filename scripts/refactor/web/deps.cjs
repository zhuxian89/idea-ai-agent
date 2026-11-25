#!/usr/bin/env node
// deps trim <file>...   remove what an extracted hook or component no longer uses:
//                       destructured names, then whole `xApi` parameters (and their Deps field and import).
// deps pick <file>...   narrow every `xApi: ReturnType<typeof useX>` field of Deps to
//                       `Pick<ReturnType<typeof useX>, "a" | "b">`, listing exactly the names the file destructures.
//                       Documents real needs in the type; callers keep passing the whole object.
// deps stats <file>...  print, per Api parameter, how many fields the file really uses.
//
// The file must export one function whose first parameter is `{ aApi, bApi, ... }: Deps` and whose body reads
// the hooks' results with `const { a, b } = aApi;` statements (the shape appsplit/jsxextract generate).
const path = require('path');
const fs = require('fs');
const { webRoot, ts } = require('../lib/paths.cjs');
const [cmd, ...files] = process.argv.slice(2);
if (!['trim', 'pick', 'stats'].includes(cmd) || !files.length) { console.error('usage: deps trim|pick|stats <file>...'); process.exit(2); }

function analyse(file) {
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.body && s.parameters.length && ts.isObjectBindingPattern(s.parameters[0].name));
  const depsType = sf.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'Deps');
  return { text, sf, fn, depsType };
}
function usedIn(body, skipStatements) {
  const used = new Set();
  const collect = (n) => {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isName = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isPropertyAssignment(p) && p.name === n) || (ts.isJsxAttribute(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n) || (ts.isPropertySignature(p) && p.name === n);
      if (!isName) used.add(n.text);
    }
    ts.forEachChild(n, collect);
  };
  body.statements.filter((s) => !skipStatements.has(s)).forEach(collect);
  return used;
}
const destructureOf = (st) => {
  if (!ts.isVariableStatement(st) || st.declarationList.declarations.length !== 1) return null;
  const d = st.declarationList.declarations[0];
  if (!ts.isObjectBindingPattern(d.name) || !d.initializer || !ts.isIdentifier(d.initializer)) return null;
  return { st, d, api: d.initializer.text, names: d.name.elements.map((e) => e.name.getText()) };
};

for (const arg of files) {
  const file = path.resolve(arg);
  let { text, sf, fn, depsType } = analyse(file);
  if (!fn || !depsType) { console.log(`${arg}: no hook/component with a Deps type, skipped`); continue; }
  const params = fn.parameters[0].name.elements.map((e) => e.name.text);
  const ds = fn.body.statements.map(destructureOf).filter(Boolean);
  if (cmd === 'stats') {
    const wholeUse = new Set();
    const skip = new Set(ds.map((x) => x.st));
    const others = usedIn(fn.body, skip);
    console.log(`${path.relative(process.cwd(), file)}:`);
    for (const p of params) {
      const fields = ds.filter((x) => x.api === p).flatMap((x) => x.names);
      console.log(`  ${p}: ${fields.length} field(s)${others.has(p) ? ' [also used as a whole]' : ''}`);
    }
    continue;
  }
  if (cmd === 'trim') {
    // 1. drop destructured names nothing reads
    const skip = new Set(ds.map((x) => x.st));
    const used = usedIn(fn.body, skip);
    const edits = [];
    for (const x of ds) {
      const keep = x.d.name.elements.filter((e) => used.has(e.name.getText()));
      if (keep.length === x.d.name.elements.length) continue;
      let from = x.st.getStart(); while (from > 0 && text[from - 1] === ' ') from--;
      if (!keep.length) edits.push([from, x.st.getEnd() + (text[x.st.getEnd()] === '\n' ? 1 : 0), '']);
      else edits.push([x.st.getStart(), x.st.getEnd(), `const { ${keep.map((e) => e.getText()).join(', ')} } = ${x.api};`]);
    }
    edits.sort((a, b) => b[0] - a[0]);
    for (const [a, b, r] of edits) text = text.slice(0, a) + r + text.slice(b);
    fs.writeFileSync(file, text);
    // 2. drop parameters nothing reads any more
    ({ text, sf, fn, depsType } = analyse(file));
    const stillUsed = usedIn(fn.body, new Set());
    const unused = params.filter((p) => !stillUsed.has(p));
    if (unused.length) {
      const e2 = [];
      const sig = fn.parameters[0].name;
      const keptEls = sig.elements.filter((e) => !unused.includes(e.name.text));
      const paramsText = keptEls.map((e) => e.getText()).join(', ');
      e2.push([sig.getStart(), sig.getEnd(), keptEls.length ? `{ ${paramsText} }` : '']);
      for (const m of depsType.type.members) if (unused.includes(m.name.getText())) { let from = m.getFullStart(); e2.push([from, m.getEnd() + (text[m.getEnd()] === ';' ? 1 : 0), '']); }
      e2.sort((a, b) => b[0] - a[0]);
      for (const [a, b, r] of e2) text = text.slice(0, a) + r + text.slice(b);
      // empty Deps and its annotation
      if (!keptEls.length) {
        text = text.replace(/\}: Deps\)/, ')').replace(/\(: Deps\)/, '()').replace(/\n*type Deps = \{\s*\};?\n/, '\n');
      }
      fs.writeFileSync(file, text);
    }
    // 2b. remove the dropped parameters at every call site (`useX({ aApi, ... })` and `<Comp aApi={aApi} />`)
    if (unused.length) {
      const name = fn.name.text;
      const srcRoot = path.join(webRoot, 'src');
      const walkDir = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
      for (const f of walkDir(srcRoot)) {
        if (f === file) continue;
        const ftext = fs.readFileSync(f, 'utf8');
        if (!ftext.includes(name)) continue;
        const fsf = ts.createSourceFile(f, ftext, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        const e4 = [];
        const visit = (n) => {
          if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
            const obj = n.arguments[0];
            const keep = obj.properties.filter((pr) => !(pr.name && unused.includes(pr.name.getText())));
            if (keep.length !== obj.properties.length) e4.push([obj.getStart(), obj.getEnd(), keep.length ? `{ ${keep.map((k) => k.getText()).join(', ')} }` : '']);
          }
          if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText() === name) {
            for (const at of n.attributes.properties) if (ts.isJsxAttribute(at) && unused.includes(at.name.getText())) { let from = at.getFullStart(); e4.push([from, at.getEnd(), '']); }
          }
          ts.forEachChild(n, visit);
        };
        visit(fsf);
        if (!e4.length) continue;
        e4.sort((a, b) => b[0] - a[0]);
        let o = ftext; for (const [a, b, r] of e4) o = o.slice(0, a) + r + o.slice(b);
        o = o.replace(new RegExp(name + '\\(\\)', 'g'), name + '()');
        fs.writeFileSync(f, o);
        console.log(`  call site updated: ${path.relative(process.cwd(), f)}`);
      }
    }
    // 3. drop `import type { useX }` whose hook is no longer referenced
    const { sf: sf3, text: t3 } = analyse(file);
    const ids = new Set(); const col = (n) => { if (ts.isIdentifier(n) && !(n.parent && ts.isImportSpecifier(n.parent))) ids.add(n.text); ts.forEachChild(n, col); };
    sf3.statements.filter((s) => !ts.isImportDeclaration(s)).forEach(col);
    let out = t3; const e3 = [];
    for (const d of sf3.statements.filter(ts.isImportDeclaration)) {
      const c = d.importClause; if (!c || !c.isTypeOnly || !c.namedBindings || !ts.isNamedImports(c.namedBindings)) continue;
      if (c.namedBindings.elements.every((e) => !ids.has(e.name.text))) e3.push([d.getStart(), d.getEnd() + (t3[d.getEnd()] === '\n' ? 1 : 0)]);
    }
    e3.sort((a, b) => b[0] - a[0]);
    for (const [a, b] of e3) out = out.slice(0, a) + out.slice(b);
    fs.writeFileSync(file, out.replace(/\n{3,}/g, '\n\n'));
    console.log(`${path.relative(process.cwd(), file)}: unused parameters removed: ${unused.join(', ') || 'none'}`);
    continue;
  }
  if (cmd === 'pick') {
    const edits = [];
    for (const m of depsType.type.members) {
      const api = m.name.getText();
      const fields = ds.filter((x) => x.api === api).flatMap((x) => x.names);
      const skip = new Set(ds.map((x) => x.st));
      if (!fields.length || usedIn(fn.body, skip).has(api)) continue; // used as a whole: cannot narrow
      const t = m.type;
      if (!(ts.isTypeReferenceNode(t) && t.typeName.getText() === 'ReturnType')) continue;
      const names = [...new Set(fields)].sort().map((n) => JSON.stringify(n));
      edits.push([t.getStart(), t.getEnd(), `Pick<${t.getText()}, ${names.join(' | ')}>`]);
    }
    edits.sort((a, b) => b[0] - a[0]);
    for (const [a, b, r] of edits) text = text.slice(0, a) + r + text.slice(b);
    fs.writeFileSync(file, text);
    console.log(`${path.relative(process.cwd(), file)}: ${edits.length} field(s) narrowed`);
  }
}
