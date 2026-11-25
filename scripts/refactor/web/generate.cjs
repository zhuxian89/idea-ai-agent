// Second half of appsplit.cjs (run it through `appsplit.cjs <plan> --apply`).
// Writes one file per planned hook and rewrites the component function to call them in dependency order.
// Statement text is copied unchanged. Each hook takes the hooks it depends on as `{ xApi }` and the props
// it reads; it returns exactly the names other statements use.
const path = require('path');
const fs = require('fs');
const M = require('./appsplit.cjs');
const { info, hookOf, order, plan, body, sf, fn, text, srcFile, srcDir, outDir, ts } = M;
const hooks = plan.hooks;
hooks.forEach((h) => { if (!h.instance.endsWith('Api')) h.instance += 'Api'; });
const ext = (hi) => (info.some((r) => hookOf[r.i] === hi && r.hasJsx) ? '.tsx' : '.ts');
const hookFile = (hi) => hooks[hi].name + ext(hi);

function fmtImport(typeOnly, parts, spec) {
  const one = `import ${typeOnly ? 'type ' : ''}${parts.join(', ')} from ${spec};`;
  if (one.length <= 100) return one;
  const head = parts.map((p) => {
    if (!p.startsWith('{ ')) return p;
    return '{\n' + p.slice(2, -2).split(', ').map((i) => '  ' + i + ',').join('\n') + '\n}';
  });
  return `import ${typeOnly ? 'type ' : ''}${head.join(', ')} from ${spec};`;
}
// A statement may use a later statement of its own hook inside a deferred closure; emit dependencies first.
function stableTopo(list) {
  const inHook = new Set(list); const placed = new Set(); const out = [];
  const visit = (s, stack) => {
    if (placed.has(s) || stack.has(s)) return;
    stack.add(s);
    for (const j of info[s].uses.keys()) if (inHook.has(j) && j > s) visit(j, stack);
    placed.add(s); out.push(s);
  };
  for (const s of list) visit(s, new Set());
  return out;
}
const imps = sf.statements.filter(ts.isImportDeclaration);
const localToImport = new Map();
for (const d of imps) {
  const c = d.importClause; if (!c) continue;
  const spec = d.moduleSpecifier.text;
  if (c.name) localToImport.set(c.name.text, { d, spec, kind: 'default', text: c.name.text });
  const nb = c.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) localToImport.set(nb.name.text, { d, spec, kind: 'ns', text: '* as ' + nb.name.text });
  else if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) localToImport.set(e.name.text, { d, spec, kind: 'named', text: e.getText() });
}
const relSpec = (spec, fromDir) => {
  if (!spec.startsWith('.')) return spec;
  let r = path.relative(fromDir, path.resolve(srcDir, spec)).split(path.sep).join('/');
  if (!r.startsWith('.')) r = './' + r;
  return r;
};
const stmtText = (s) => text.slice(body[s].getFullStart(), body[s].getEnd()).replace(/^\s*\n/, '').replace(/^\n+/, '');

// names that other statements read from each hook
const outputs = hooks.map(() => new Set());
info.forEach((r) => r.uses.forEach((names, j) => {
  const hj = hookOf[j];
  if (hj === -1 || hj === hookOf[r.i]) return;
  names.forEach((n) => outputs[hj].add(n));
}));

// module level constants used by hooks move into their own files
const moduleDecl = new Map();
for (const st of sf.statements) {
  if (st === fn) continue;
  if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => { if (ts.isIdentifier(d.name)) moduleDecl.set(d.name.text, st); });
}
const moduleFiles = new Map();
const hookModuleRefs = new Set();
info.forEach((r) => { if (hookOf[r.i] !== -1) r.moduleRefs.forEach((n) => hookModuleRefs.add(n)); });
for (const n of hookModuleRefs) {
  const st = moduleDecl.get(n);
  if (!st) { console.error('cannot move module level declaration ' + n); process.exit(1); }
  const ids = new Set(); const collectIds = (x) => { if (ts.isIdentifier(x)) ids.add(x.text); ts.forEachChild(x, collectIds); }; collectIds(st);
  const byMod = new Map();
  for (const idn of ids) {
    const im = localToImport.get(idn); if (!im) continue;
    const spec = relSpec(im.spec, outDir);
    if (!byMod.has(spec)) byMod.set(spec, { spec, items: [], def: null });
    const m = byMod.get(spec); if (im.kind === 'default') m.def = im.text; else m.items.push(im.text);
  }
  const lines = [];
  for (const m of byMod.values()) { const parts = []; if (m.def) parts.push(m.def); if (m.items.length) parts.push('{ ' + m.items.join(', ') + ' }'); lines.push(fmtImport(false, parts, '"' + m.spec + '"')); }
  moduleFiles.set(n, { file: n + '.ts', text: lines.join('\n') + '\n\nexport ' + text.slice(st.getStart(), st.getEnd()) + '\n', stmt: st });
}

const PT = plan.propsType || { name: 'AppProps', from: './appProps', local: true };
hooks.forEach((h, hi) => {
  const stmts = stableTopo(h.stmts);
  const need = new Set(); let usesProps = false; const moduleRefs = new Set();
  const provNames = new Map();
  const propNames = new Set();
  stmts.forEach((s) => {
    info[s].imports.forEach((n) => need.add(n));
    if (info[s].usesProps) usesProps = true;
    info[s].propNames.forEach((n) => propNames.add(n));
    info[s].moduleRefs.forEach((n) => moduleRefs.add(n));
    info[s].uses.forEach((names, j) => {
      const hj = hookOf[j]; if (hj === hi) return;
      if (!provNames.has(hj)) provNames.set(hj, new Set());
      names.forEach((n) => provNames.get(hj).add(n));
    });
  });
  const byMod = new Map();
  for (const n of need) {
    const im = localToImport.get(n); if (!im) continue;
    const spec = relSpec(im.spec, path.dirname(path.join(outDir, hookFile(hi))));
    const key = spec + '|' + (im.d.importClause.isTypeOnly ? 'type' : '');
    if (!byMod.has(key)) byMod.set(key, { spec, typeOnly: im.d.importClause.isTypeOnly, def: null, ns: null, named: [] });
    const m = byMod.get(key);
    if (im.kind === 'default') m.def = im.text; else if (im.kind === 'ns') m.ns = im.text; else m.named.push(im.text);
  }
  const lines = [];
  for (const m of byMod.values()) {
    const parts = [];
    if (m.def) parts.push(m.def);
    if (m.ns) parts.push(m.ns);
    if (m.named.length) parts.push('{ ' + m.named.join(', ') + ' }');
    lines.push(fmtImport(m.typeOnly, parts, '"' + m.spec + '"'));
  }
  const provs = [...provNames.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  for (const hj of provs) lines.push(`import type { ${hooks[hj].name} } from "./${hooks[hj].name}";`);
  moduleRefs.forEach((n) => { lines.push(`import { ${n} } from "./${n}";`); });
  if (usesProps) lines.push(`import type { ${PT.name} } from "${PT.local ? PT.from : relSpec(PT.from, path.dirname(path.join(outDir, hookFile(hi))))}";`);
  const depsFields = provs.map((hj) => `  ${hooks[hj].instance}: ReturnType<typeof ${hooks[hj].name}>;`);
  if (usesProps) {
    const pn = [...propNames].sort();
    if (plan.propsType) {
      const defaulted = new Set(); for (const e of fn.parameters[0].name.elements) if (e.initializer) defaulted.add(e.name.text);
      const plain = pn.filter((n) => !defaulted.has(n)), def = pn.filter((n) => defaulted.has(n));
      const parts = [];
      if (plain.length) parts.push(`Pick<${PT.name}, ${plain.map((n) => JSON.stringify(n)).join(' | ')}>`);
      if (def.length) parts.push(`Required<Pick<${PT.name}, ${def.map((n) => JSON.stringify(n)).join(' | ')}>>`);
      depsFields.push(`  props: ${parts.join(' & ')};`);
    } else depsFields.push(`  props: ${PT.name};`);
  }
  let out = lines.join('\n') + '\n\n';
  const hasDeps = depsFields.length > 0;
  if (hasDeps) out += `type Deps = {\n${depsFields.join('\n')}\n};\n\n`;
  const paramNames = [...provs.map((hj) => hooks[hj].instance), ...(usesProps ? ['props'] : [])];
  out += `export function ${h.name}(${hasDeps ? `{ ${paramNames.join(', ')} }: Deps` : ''}) {\n`;
  for (const hj of provs) out += `  const { ${[...provNames.get(hj)].sort().join(', ')} } = ${hooks[hj].instance};\n`;
  if (usesProps && plan.propsType) out += `  const { ${[...propNames].sort().join(', ')} } = props;\n`;
  if (provs.length || usesProps) out += '\n';
  out += stmts.map(stmtText).join('\n') + '\n';
  const outs = [...outputs[hi]].sort();
  if (outs.length) out += `\n  return { ${outs.join(', ')} };\n`;
  out += '}\n';
  h.__outputs = outs; h.__file = hookFile(hi); h.__text = out; h.__usesProps = usesProps; h.__propNames = [...propNames].sort();
});

// ---- rewrite the component function
const stay = info.filter((r) => hookOf[r.i] === -1).map((r) => r.i);
const stayUses = new Map();
stay.forEach((s) => info[s].uses.forEach((names, j) => { const hj = hookOf[j]; if (hj === -1) return; if (!stayUses.has(hj)) stayUses.set(hj, new Set()); names.forEach((n) => stayUses.get(hj).add(n)); }));
let app = '';
const stayUsesProps = stay.some((s) => info[s].usesProps);
for (const hi of order) {
  const h = hooks[hi];
  const provs = new Set();
  info.forEach((r) => { if (hookOf[r.i] !== hi) return; r.uses.forEach((names, j) => { const hj = hookOf[j]; if (hj !== hi && hj !== -1) provs.add(hj); }); });
  const args = [...provs].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((hj) => hooks[hj].instance);
  if (h.__usesProps) args.push(plan.propsType ? `props: { ${h.__propNames.join(', ')} }` : 'props');
  app += `  ${h.__outputs.length > 0 ? `const ${h.instance} = ` : ''}${h.name}(${args.length ? `{ ${args.join(', ')} }` : ''});\n`;
}
for (const hi of order) {
  const names = stayUses.get(hi); if (!names || !names.size) continue;
  app += `  const { ${[...names].sort().join(', ')} } = ${hooks[hi].instance};\n`;
}
app += '\n' + stay.map((s) => stmtText(s)).join('\n') + '\n';
const propDestructure = fn.parameters[0] ? fn.parameters[0].name.getText() : '';
const newHeader = plan.keepParams
  ? text.slice(fn.getStart(), fn.body.getStart() + 1) + '\n'
  : `export function ${plan.fnName}(props: AppProps) {\n` + (stayUsesProps ? `  const ${propDestructure} = props;\n` : '');
const newFn = newHeader + app + '}';
let newText = text.slice(0, fn.getStart()) + newFn + text.slice(fn.getEnd());
const appPropsDecl = plan.keepParams ? null : sf.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === 'AppProps');
if (appPropsDecl) {
  const a = appPropsDecl.getFullStart(), b = appPropsDecl.getEnd();
  newText = text.slice(0, fn.getStart()).replace(text.slice(a, b), '') + newFn + text.slice(fn.getEnd());
}
for (const [, m] of moduleFiles) newText = newText.replace(text.slice(m.stmt.getFullStart(), m.stmt.getEnd()), '');
const prefix = plan.importPrefix || './app/workbench';
const addImports = hooks.map((h) => `import { ${h.name} } from "${prefix}/${h.name}";`).join('\n')
  + (plan.keepParams ? '\n' : `\nimport type { AppProps } from "${prefix}/appProps";\n`);

// drop imports the function file no longer uses
const tmp = ts.createSourceFile('tmp.tsx', newText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const used = new Set();
const collect = (n) => { if (ts.isIdentifier(n) && !(n.parent && (ts.isImportSpecifier(n.parent) || ts.isImportClause(n.parent) || ts.isNamespaceImport(n.parent)))) used.add(n.text); ts.forEachChild(n, collect); };
tmp.statements.filter((s) => !ts.isImportDeclaration(s)).forEach(collect);
let pruned = newText; const edits = [];
for (const d of tmp.statements.filter(ts.isImportDeclaration)) {
  const c = d.importClause; if (!c) continue;
  const keep = (n) => used.has(n);
  const parts = []; let allUsed = true;
  if (c.name) { if (keep(c.name.text)) parts.push(c.name.text); else allUsed = false; }
  const nb = c.namedBindings;
  if (nb && ts.isNamespaceImport(nb)) { if (keep(nb.name.text)) parts.push('* as ' + nb.name.text); else allUsed = false; }
  if (nb && ts.isNamedImports(nb)) {
    const els = nb.elements.filter((e) => keep(e.name.text));
    if (els.length !== nb.elements.length) allUsed = false;
    if (els.length) parts.push('{ ' + els.map((e) => e.getText()).join(', ') + ' }');
  }
  if (allUsed) continue;
  const endPos = d.getEnd() + (!parts.length && newText[d.getEnd()] === '\n' ? 1 : 0);
  edits.push([d.getStart(), endPos, parts.length ? fmtImport(c.isTypeOnly, parts, d.moduleSpecifier.getText()) : '']);
}
edits.sort((a, b) => b[0] - a[0]);
for (const [a, b, r] of edits) pruned = pruned.slice(0, a) + r + pruned.slice(b);
const tmp2 = ts.createSourceFile('tmp.tsx', pruned, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lastImp = tmp2.statements.filter(ts.isImportDeclaration).pop();
pruned = pruned.slice(0, lastImp.getEnd()) + '\n' + addImports.trimEnd() + pruned.slice(lastImp.getEnd());
pruned = pruned.replace(/\n{3,}/g, '\n\n');
fs.mkdirSync(outDir, { recursive: true });
hooks.forEach((h) => fs.writeFileSync(path.join(outDir, h.__file), h.__text));
for (const [, m] of moduleFiles) fs.writeFileSync(path.join(outDir, m.file), m.text);
if (!plan.keepParams) fs.writeFileSync(path.join(outDir, 'appProps.ts'), 'export type AppProps = {\n  onGoHome?: () => void;\n};\n');
fs.writeFileSync(srcFile, pruned);
console.log(`written ${hooks.length} hooks to ${path.relative(process.cwd(), outDir)}; module level declarations moved: ${[...moduleFiles.keys()].join(', ') || 'none'}`);
