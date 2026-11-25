#!/usr/bin/env node
// jsxmap <file.tsx> <ComponentFunction> [depth]   outline the JSX returned by a component with line ranges
// and sizes (nodes of 12+ lines), to pick subtrees worth extracting with jsxextract.
const path = require('path');
const fs = require('fs');
const { ts } = require('../lib/paths.cjs');
const [fileArg, fnName, depthArg] = process.argv.slice(2);
const depth = +depthArg || 3;
const file = path.resolve(fileArg);
const text = fs.readFileSync(file, 'utf8');
const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let fn; for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && st.name && st.name.text === fnName) fn = st;
if (!fn) { console.error('function not found: ' + fnName); process.exit(1); }
const ret = fn.body.statements.filter(ts.isReturnStatement).pop();
const L = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
const E = (n) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
const isJsx = (n) => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n) || ts.isJsxExpression(n);
function label(n) {
  if (ts.isJsxElement(n)) return '<' + n.openingElement.tagName.getText() + '>';
  if (ts.isJsxSelfClosingElement(n)) return '<' + n.tagName.getText() + '/>';
  if (ts.isJsxFragment(n)) return '<>';
  return '{' + (n.expression ? n.expression.getText().replace(/\s+/g, ' ').slice(0, 60) : '') + '}';
}
function walk(n, d, indent) {
  if (!isJsx(n)) { ts.forEachChild(n, (c) => walk(c, d, indent)); return; }
  const size = E(n) - L(n) + 1;
  if (size >= 12) console.log(`${indent}${L(n)}-${E(n)} (${size}) ${label(n)}`);
  if (d >= depth) return;
  if (ts.isJsxElement(n) || ts.isJsxFragment(n)) n.children.forEach((c) => walk(c, d + 1, indent + '  '));
  else if (ts.isJsxExpression(n) && n.expression) ts.forEachChild(n.expression, (c) => walk(c, d + 1, indent + '  '));
}
walk(ret.expression, 0, '');
