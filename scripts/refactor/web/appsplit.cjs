#!/usr/bin/env node
// appsplit <plan.json> [--apply]
//
// Splits the body of a React component function into domain hooks, moving statement text verbatim.
// Without --apply it only validates the plan against the real dependency graph and prints what would
// happen; with --apply it also runs generate.cjs, which writes the hook files and rewrites the function.
//
// plan.json (paths are relative to runtime/web):
//   { "file": "src/App.tsx", "fnName": "App", "outDir": "src/app/workbench",
//     "hooks": [ { "name": "useSessionList", "instance": "sessionList", "stmts": [48, 49, ...] }, ... ],
//     "acceptedEffectSwaps": [[159, 223]],       // effect pairs whose order change was reviewed by hand
//     "keepParams": false,                       // true: keep the function signature, pass props down
//     "importPrefix": "./app/workbench",         // how the function file imports the generated hooks
//     "propsType": { "name": "FileTreeProps", "from": "./fileTreeModel" } }
// Statement numbers come from `analyze.cjs --out`. Statements not listed in any hook stay in the function.
//
// What is checked, per plan:
//  * a hook may only use statements of hooks that come earlier in the generated call order (no cycles);
//  * a hook may not use a statement that stays behind in the function;
//  * effect statements (useEffect / custom hooks) change relative order when moved; every swapped pair
//    that shares a mutable carrier (a ref or setter the other one uses) is reported and must be reviewed,
//    then listed in acceptedEffectSwaps. State and callbacks are order independent; effects are not.
const path = require('path');
const fs = require('fs');
const { webRoot, ts } = require('../lib/paths.cjs');
const planFile = path.resolve(process.argv[2]);
const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const APPLY = process.argv.includes('--apply');
const srcFile = path.join(webRoot, plan.file);
const srcDir = path.dirname(srcFile);
const outDir = path.join(webRoot, plan.outDir);
const cfg = ts.readConfigFile(path.join(webRoot, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, webRoot);
const program = ts.createProgram([srcFile], parsed.options);
const checker = program.getTypeChecker();
const sf = program.getSourceFile(srcFile);
const text = sf.getFullText();
let fn = null;
for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.name.text === plan.fnName) fn = st;
if (!fn) { console.error('function not found: ' + plan.fnName); process.exit(1); }
const body = fn.body.statements;
const N = body.length;
const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

function bindNames(n, out) {
  if (ts.isIdentifier(n)) out.push(n);
  else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) for (const el of n.elements) if (!ts.isOmittedExpression(el)) bindNames(el.name, out);
}
const info = body.map((st, i) => ({ i, st, ids: [], kinds: {}, uses: new Map(), imports: new Set(), moduleRefs: new Set(), usesProps: false, propNames: new Set(), effectful: false, hasJsx: false, lets: [] }));
const symToStmt = new Map();
body.forEach((st, i) => {
  const ids = [];
  if (ts.isVariableStatement(st)) {
    const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;
    st.declarationList.declarations.forEach((d) => {
      const local = []; bindNames(d.name, local);
      const init = d.initializer;
      const callee = init && ts.isCallExpression(init) ? (ts.isIdentifier(init.expression) ? init.expression.text : (ts.isPropertyAccessExpression(init.expression) ? init.expression.name.text : '')) : '';
      local.forEach((id) => {
        // 'value' names are reactive state; 'carrier' names (refs, setters, callbacks) can be mutated from effects
        let kind = 'carrier';
        if (callee === 'useState' && ts.isArrayBindingPattern(d.name) && d.name.elements[0] && d.name.elements[0].name === id) kind = 'value';
        if (callee === 'useMemo') kind = 'value';
        info[i].kinds[id.text] = kind;
        if (!isConst) info[i].lets.push(id.text);
      });
      ids.push(...local);
    });
  } else if (ts.isFunctionDeclaration(st) && st.name) { ids.push(st.name); info[i].kinds[st.name.text] = 'carrier'; }
  info[i].ids = ids;
  for (const id of ids) { const s = checker.getSymbolAtLocation(id); if (s) symToStmt.set(s, i); }
});
const BUILTIN_HOOKS = new Set(['useState', 'useRef', 'useCallback', 'useMemo', 'useReducer', 'useContext', 'useDeferredValue', 'useId']);
const topLevelNames = new Set();
for (const st of sf.statements) {
  if (st === fn) continue;
  if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => { const l = []; bindNames(d.name, l); l.forEach((x) => topLevelNames.add(x.text)); });
  else if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name) topLevelNames.add(st.name.text);
}
function classify(sym) {
  if (!sym) return null;
  const d = sym.declarations && sym.declarations[0];
  if (!d) return null;
  if ((sym.flags & ts.SymbolFlags.Alias) && (ts.isImportSpecifier(d) || ts.isImportClause(d) || ts.isNamespaceImport(d))) return { kind: 'import', name: sym.name };
  if (symToStmt.has(sym)) return { kind: 'stmt', j: symToStmt.get(sym) };
  if (ts.isBindingElement(d) || ts.isParameter(d)) {
    let p = d; while (p && !ts.isParameter(p)) p = p.parent;
    if (p && p.parent === fn) return { kind: 'prop', name: sym.name };
  }
  if (d.getSourceFile() === sf && d.parent && d.parent.parent && d.parent.parent.parent === sf && topLevelNames.has(sym.name)) return { kind: 'module', name: sym.name };
  if (d.parent && d.parent.parent === sf && topLevelNames.has(sym.name)) return { kind: 'module', name: sym.name };
  return null;
}
const EAGER = new Set(['useMemo', 'useState', 'useReducer', 'useSyncExternalStore']);
const EFFECT_NAMES = new Set(['useEffect', 'useLayoutEffect', 'useInsertionEffect', 'useImperativeHandle']);
function walk(n, i, deferred, rec) {
  if (ts.isFunctionLike(n) && n !== body[i]) {
    const p = n.parent;
    let eager = false;
    if (p && ts.isCallExpression(p) && p.arguments[0] === n) { const c = p.expression; const nm = ts.isIdentifier(c) ? c.text : (ts.isPropertyAccessExpression(c) ? c.name.text : ''); if (EAGER.has(nm)) eager = true; }
    deferred = deferred || !eager;
  }
  if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) rec.hasJsx = true;
  if (ts.isCallExpression(n)) {
    const c = n.expression; const nm = ts.isIdentifier(c) ? c.text : (ts.isPropertyAccessExpression(c) ? c.name.text : '');
    if (/^use[A-Z]/.test(nm) && !BUILTIN_HOOKS.has(nm)) rec.effectful = true;
  }
  if (ts.isIdentifier(n)) {
    const p = n.parent;
    const skip = (ts.isPropertyAccessExpression(p) && p.name === n) || (ts.isQualifiedName(p) && p.right === n) || (ts.isPropertyAssignment(p) && p.name === n)
      || (ts.isJsxAttribute(p) && p.name === n) || (ts.isBindingElement(p) && p.propertyName === n) || (ts.isPropertySignature(p) && p.name === n) || (ts.isMethodDeclaration(p) && p.name === n)
      || (ts.isEnumMember(p) && p.name === n);
    if (!skip) {
      let sym = checker.getSymbolAtLocation(n);
      if (p && ts.isShorthandPropertyAssignment(p) && p.name === n) sym = checker.getShorthandAssignmentValueSymbol(p) || sym;
      const c = classify(sym);
      if (c) {
        if (c.kind === 'import') rec.imports.add(n.text);
        else if (c.kind === 'prop') { rec.usesProps = true; rec.propNames.add(n.text); }
        else if (c.kind === 'module') rec.moduleRefs.add(c.name);
        else if (c.kind === 'stmt' && c.j !== rec.i) {
          if (!rec.uses.has(c.j)) rec.uses.set(c.j, new Set());
          rec.uses.get(c.j).add(n.text);
        }
      }
    }
  }
  ts.forEachChild(n, (ch) => walk(ch, i, deferred, rec));
}
info.forEach((r) => {
  walk(r.st, r.i, false, r);
  const t = r.st;
  if (ts.isExpressionStatement(t) && ts.isCallExpression(t.expression)) {
    const c = t.expression.expression; const nm = ts.isIdentifier(c) ? c.text : (ts.isPropertyAccessExpression(c) ? c.name.text : '');
    if (EFFECT_NAMES.has(nm)) r.effectful = true;
  }
});

// ---- plan assignment
const hookOf = new Array(N).fill(-1);
plan.hooks.forEach((h) => { h.stmts = h.stmts.slice().sort((a, b) => a - b); });
plan.hooks.forEach((h, hi) => h.stmts.forEach((s) => { if (hookOf[s] !== -1) console.error('statement ' + s + ' is assigned twice'); hookOf[s] = hi; }));
const errors = [], warns = [];
const H = plan.hooks.length;
const hedges = Array.from({ length: H }, () => new Map());
info.forEach((r) => {
  const hi = hookOf[r.i];
  r.uses.forEach((names, j) => {
    const hj = hookOf[j];
    if (hi === -1) return;
    if (hj === -1) { errors.push(`hook ${plan.hooks[hi].name} stmt ${r.i}(line ${lineOf(r.st.getStart())}) uses STAY stmt ${j}: ${[...names]}`); return; }
    if (hj === hi) { if (j > r.i) warns.push(`hook ${plan.hooks[hi].name}: stmt ${r.i} uses later stmt ${j} in the same hook (will be reordered)`); return; }
    if (!hedges[hi].has(hj)) hedges[hi].set(hj, []);
    hedges[hi].get(hj).push([r.i, j, [...names]]);
  });
});
const minIdx = plan.hooks.map((h) => (h.stmts.length ? h.stmts[0] : 1e9));
const order = []; let cyc = false;
const done = new Set();
while (order.length < H) {
  const ready = [];
  for (let a = 0; a < H; a++) if (!done.has(a) && [...hedges[a].keys()].every((b) => done.has(b))) ready.push(a);
  if (!ready.length) { cyc = true; break; }
  ready.sort((x, y) => minIdx[x] - minIdx[y]); order.push(ready[0]); done.add(ready[0]);
}
if (cyc) {
  const rest = []; for (let a = 0; a < H; a++) if (!done.has(a)) rest.push(a);
  errors.push('CYCLE among hooks: ' + rest.map((a) => plan.hooks[a].name).join(', '));
  for (const a of rest) for (const [b, pairs] of hedges[a]) if (rest.includes(b)) errors.push(`   ${plan.hooks[a].name} -> ${plan.hooks[b].name}: ` + pairs.slice(0, 3).map((p) => `s${p[0]}->s${p[1]}(${p[2].slice(0, 3)})`).join(' '));
}
const effIdx = info.filter((r) => r.effectful).map((r) => r.i);
if (!cyc) {
  const newPos = new Map(); let pos = 0;
  for (const hi of order) for (const s of plan.hooks[hi].stmts) if (info[s].effectful) newPos.set(s, pos++);
  for (let s = 0; s < N; s++) if (hookOf[s] === -1 && info[s].effectful) newPos.set(s, pos++);
  const carriers = (r) => { const out = new Set(); r.uses.forEach((names, j) => names.forEach((n) => { if (info[j].kinds[n] === 'carrier') out.add(n); })); return out; };
  let inversions = 0, conflicts = 0;
  for (let a = 0; a < effIdx.length; a++) for (let b = a + 1; b < effIdx.length; b++) {
    const ea = effIdx[a], eb = effIdx[b];
    if (newPos.get(ea) <= newPos.get(eb)) continue;
    inversions++;
    const ca = carriers(info[ea]), cb = carriers(info[eb]);
    const shared = [...ca].filter((x) => cb.has(x));
    const dep = info[eb].uses.has(ea) || info[ea].uses.has(eb);
    if (!shared.length && !dep) continue;
    if ((plan.acceptedEffectSwaps || []).some(([x, y]) => (x === ea && y === eb) || (x === eb && y === ea))) continue;
    conflicts++;
    const nm = (s) => (plan.hooks[hookOf[s]] ? plan.hooks[hookOf[s]].name : 'stay');
    warns.push(`EFFECT ORDER s${ea}(L${lineOf(info[ea].st.getStart())},${nm(ea)}) and s${eb}(L${lineOf(info[eb].st.getStart())},${nm(eb)}) swapped; shared=${shared.join(',')}${dep ? ' direct-dependency' : ''}`);
  }
  console.log(`effectful statements: ${effIdx.length}; reordered pairs: ${inversions}; reordered pairs sharing mutable carriers and not yet accepted: ${conflicts}`);
}
console.log('hook order:', order.map((h) => plan.hooks[h].name).join(' > '));
info.forEach((r) => { if (hookOf[r.i] !== -1 && r.lets.length) warns.push(`let-declared in hook: s${r.i} ${r.lets}`); });
const stay = info.filter((r) => hookOf[r.i] === -1);
console.log('stay statements:', stay.length, 'lines:', stay.reduce((a, r) => a + lineOf(r.st.getEnd()) - lineOf(r.st.getStart()) + 1, 0));
plan.hooks.forEach((h, hi) => console.log(`  ${h.name}: ${h.stmts.length} stmts, ${h.stmts.reduce((a, s) => a + lineOf(info[s].st.getEnd()) - lineOf(info[s].st.getStart()) + 1, 0)} lines, deps: ${[...hedges[hi].keys()].map((b) => plan.hooks[b].name).join(', ')}`));
if (errors.length) { console.log('ERRORS (' + errors.length + '):'); errors.slice(0, 40).forEach((e) => console.log('  ' + e)); }
if (warns.length) { console.log('WARNINGS (' + warns.length + '):'); warns.slice(0, 40).forEach((e) => console.log('  ' + e)); }
const moduleRefs = new Set(); info.forEach((r) => { if (hookOf[r.i] !== -1) r.moduleRefs.forEach((x) => moduleRefs.add(x)); });
if (moduleRefs.size) console.log('hooks reference module level declarations (they move to their own files):', [...moduleRefs].join(', '));
module.exports = { info, hookOf, order, errors, warns, plan, body, sf, fn, text, srcFile, srcDir, outDir, lineOf, ts, N, hedges, cyc };
if (require.main === module) {
  if (errors.length || cyc) process.exit(1);
  if (APPLY) require('./generate.cjs');
}
