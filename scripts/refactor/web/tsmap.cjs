#!/usr/bin/env node
// tsmap <file.ts|tsx>...   list every top-level declaration with its line range, to plan a split.
const path = require('path');
const fs = require('fs');
const { ts } = require('../lib/paths.cjs');
for (const arg of process.argv.slice(2)) {
  const file = path.resolve(arg);
  const text = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const items = [];
  for (const st of sf.statements) {
    let names;
    if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isEnumDeclaration(st)) names = [st.name ? st.name.text : 'default'];
    else if (ts.isVariableStatement(st)) names = st.declarationList.declarations.map((d) => d.name.getText());
    else continue;
    const a = sf.getLineAndCharacterOfPosition(st.getStart()).line + 1;
    const b = sf.getLineAndCharacterOfPosition(st.getEnd()).line + 1;
    items.push(`${a}-${b}:${names.join(',')}`);
  }
  console.log(`== ${arg} (${text.split('\n').length} lines)`);
  console.log(items.join('  '));
}
