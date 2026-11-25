#!/usr/bin/env node
// analyze <file.tsx> <ComponentFunction> [--out graph.json]
// Statement level dependency graph of one component function body, resolved with the TypeScript checker.
// Reports forward references (a statement that uses something declared later) and strongly connected
// components. A body without cycles can be split into hooks along any cut that follows the graph.
const path = require('path');
const fs = require('fs');
const { webRoot, ts } = require('../lib/paths.cjs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : null;
const [fileArg, fnName] = args;
const target = path.resolve(fileArg);
const cfg = ts.readConfigFile(path.join(webRoot, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, webRoot);
const program = ts.createProgram([target], parsed.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(target);
let fn = null;
for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.name.text === fnName) fn = st;
if (!fn) { console.error('function not found: ' + fnName); process.exit(1); }
const body = fn.body.statements;
const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const endLineOf = (n) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
function collectNames(nameNode, out) {
  if (ts.isIdentifier(nameNode)) out.push(nameNode);
  else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) for (const el of nameNode.elements) if (!ts.isOmittedExpression(el)) collectNames(el.name, out);
}
const declared = body.map(() => []);
const symToStmt = new Map();
body.forEach((st, i) => {
  const ids = [];
  if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => collectNames(d.name, ids));
  else if (ts.isFunctionDeclaration(st) && st.name) ids.push(st.name);
  ids.forEach((id) => { declared[i].push(id.text); const s = checker.getSymbolAtLocation(id); if (s) symToStmt.set(s, i); });
});
const EAGER = new Set(['useMemo', 'useState', 'useReducer', 'useSyncExternalStore', 'useRef', 'useContext']);
const uses = body.map(() => new Map());
function isEagerArrow(node) {
  const p = node.parent;
  if (p && ts.isCallExpression(p) && p.arguments[0] === node) {
    const c = p.expression;
    return EAGER.has(ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : '');
  }
  return false;
}
function visit(node, i, deferred) {
  if (ts.isFunctionLike(node) && node !== body[i]) deferred = deferred || !isEagerArrow(node);
  if (ts.isIdentifier(node)) {
    const p = node.parent;
    const skip = (ts.isPropertyAccessExpression(p) && p.name === node) || (ts.isQualifiedName(p) && p.right === node) || (ts.isPropertyAssignment(p) && p.name === node)
      || (ts.isJsxAttribute(p) && p.name === node) || (ts.isBindingElement(p) && p.propertyName === node) || (ts.isPropertySignature(p) && p.name === node) || (ts.isMethodDeclaration(p) && p.name === node);
    if (!skip) {
      let sym = checker.getSymbolAtLocation(node);
      if (p && ts.isShorthandPropertyAssignment(p) && p.name === node) sym = checker.getShorthandAssignmentValueSymbol(p) || sym;
      const j = sym ? symToStmt.get(sym) : undefined;
      if (j !== undefined && j !== i) {
        const m = uses[i];
        if (!m.has(j)) m.set(j, { eager: false, names: new Set() });
        const e = m.get(j); e.names.add(node.text); if (!deferred) e.eager = true;
      }
    }
  }
  ts.forEachChild(node, (c) => visit(c, i, deferred));
}
body.forEach((st, i) => visit(st, i, false));
const graph = body.map((st, i) => ({
  i, start: lineOf(st), end: endLineOf(st), kind: ts.SyntaxKind[st.kind], declared: declared[i],
  first: st.getText().split('\n')[0].slice(0, 90),
  uses: [...uses[i].entries()].map(([j, v]) => ({ j, eager: v.eager, names: [...v.names] })),
}));
if (outFile) fs.writeFileSync(outFile, JSON.stringify(graph));
// forward references and cycles
const forward = [];
graph.forEach((s) => s.uses.forEach((u) => { if (u.j > s.i) forward.push({ from: s.i, to: u.j, names: u.names, eager: u.eager }); }));
const idx = new Map(), low = new Map(), on = new Set(), stack = [], comps = []; let counter = 0;
const strong = (v) => {
  idx.set(v, counter); low.set(v, counter); counter++; stack.push(v); on.add(v);
  for (const u of graph[v].uses) {
    if (!idx.has(u.j)) { strong(u.j); low.set(v, Math.min(low.get(v), low.get(u.j))); }
    else if (on.has(u.j)) low.set(v, Math.min(low.get(v), idx.get(u.j)));
  }
  if (low.get(v) === idx.get(v)) { const comp = []; for (;;) { const w = stack.pop(); on.delete(w); comp.push(w); if (w === v) break; } comps.push(comp); }
};
for (let v = 0; v < graph.length; v++) if (!idx.has(v)) strong(v);
const cycles = comps.filter((c) => c.length > 1);
console.log(`${fnName}: ${graph.length} statements, lines ${lineOf(fn)}-${endLineOf(fn)}`);
console.log(`forward references: ${forward.length} (eager: ${forward.filter((f) => f.eager).length})`);
forward.slice(0, 10).forEach((f) => console.log(`  stmt ${f.from} (line ${graph[f.from].start}) uses later stmt ${f.to} (line ${graph[f.to].start}): ${f.names.join(', ')}${f.eager ? ' [eager]' : ''}`));
console.log(`dependency cycles: ${cycles.length}${cycles.length ? ' sizes ' + cycles.map((c) => c.length).join(',') : ''}`);
