#!/usr/bin/env python3
"""webcmp.py <baseSrcDir> [workSrcDir] [-v]

Proves a frontend refactoring only moved code. It compares the multiset of source lines of every .ts/.tsx
file under both trees, ignoring import lines and the `export ` prefix. `lost` are lines that existed before and
are gone now; with -v they are listed. A pure move loses only import member names, function signatures that
were rewritten and comments.

  git archive HEAD runtime/web/src | tar -x -C /tmp/base
  python3 scripts/refactor/web/webcmp.py /tmp/base/runtime/web/src -v
"""
import collections
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
args = [a for a in sys.argv[1:] if not a.startswith('-')]
verbose = '-v' in sys.argv
if not args:
    sys.exit(__doc__)
base = pathlib.Path(args[0])
work = pathlib.Path(args[1]) if len(args) > 1 else ROOT / 'runtime/web/src'


def lines(root):
    counter = collections.Counter()
    for path in root.rglob('*'):
        if path.suffix not in ('.ts', '.tsx'):
            continue
        for line in path.read_text(encoding='utf-8').splitlines():
            text = re.sub(r'^export (default )?', '', line.strip())
            if text and not text.startswith('import ') and not text.startswith('} from'):
                counter[text] += 1
    return counter


before, after = lines(base), lines(work)
lost = [(l, n - after.get(l, 0)) for l, n in before.items() if after.get(l, 0) < n]
added = [(l, n - before.get(l, 0)) for l, n in after.items() if before.get(l, 0) < n]
print(f"lost={sum(n for _, n in lost)} added={sum(n for _, n in added)}")
if verbose:
    print('-- lost')
    for l, n in sorted(lost):
        print(f'  -{n} {l[:160]}')
    print('-- added')
    for l, n in sorted(added):
        print(f'  +{n} {l[:160]}')
