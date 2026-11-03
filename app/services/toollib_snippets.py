"""Prepares what Toollib runs for a snippet.

main.py is exactly the code you see: the edited code ("Try it") or the check ("Run check"), so the line numbers
in a traceback match. The definitions it relies on run first: imports, functions, classes and UPPER_CASE
constants of the snippets named in the check's first line "# needs: a, b" and, for a check, of the snippet itself.
Their names are offered like built-ins: Python finds them whenever main.py does not define the name itself.
Each one runs under its own name (e.g. "lat-u1-links"), so an error inside it shows that name and its line.
Placeholders like ${x} or ${1:x} become their names. The same rules as check_nodes.py in Toollib's test folder,
which puts the same definitions in front of the check in one file.

Common libraries need no import line: a program that uses np, plt, quad, math … without defining them gets the
import from AUTO (and the console says which). Snippets you copy elsewhere still carry their own imports.
"""
import ast
import builtins
import json
import linecache
import os
import re
import sys

_PLACEHOLDER = re.compile(r"\$\{(?:\d+:)?([^}]*)\}")
_CONSTANT = re.compile(r"[A-Z][A-Z0-9_]+")
_MISSING = object()
_BUILTIN_NAMES = set(dir(builtins))
_offered = {}    # name -> what builtins had before (or _MISSING)
_pending = []    # [(name, code)] of the run being prepared
_autos = []      # import lines added for this run
_main = ""

# Names a program may use without importing them, with the import that provides them. "sp" stays out: the
# snippets use it both for scipy.sparse and for sympy.
AUTO = {
    "np": "import numpy as np",
    "plt": "import matplotlib.pyplot as plt",
    "mpl": "import matplotlib as mpl",
    "scipy": "import scipy",
    "sympy": "import sympy",
    "Path": "from pathlib import Path",
    "dataclass": "from dataclasses import dataclass",
}
for _mod, _names in {
    "matplotlib.animation": "FuncAnimation PillowWriter",
    "scipy.integrate": "quad simpson solve_ivp",
    "scipy.optimize": "curve_fit minimize",
    "scipy.linalg": "expm",
    "scipy.sparse.linalg": "eigsh",
    "scipy.special": "iv ive i0 i1 jv",
    "scipy.fft": "fftn ifftn fftfreq fftshift",
    "collections": "Counter defaultdict deque",
}.items():
    for _n in _names.split():
        AUTO[_n] = "from %s import %s" % (_mod, _n)
for _n in "math cmath random json csv os sys re time itertools functools collections statistics".split():
    AUTO[_n] = "import " + _n


def _no_blit(mod):
    # Kobra's matplotlib backend draws whole figures; it has no blit. FuncAnimation(blit=True) then stood still
    # after the first image. A canvas without blit makes matplotlib redraw each frame instead. (Kobra has the same
    # gap; take this along when Kobra moves into Toollib.)
    mod.FigureCanvasPyIDE.supports_blit = False


try:
    import pyide_runtime
    pyide_runtime._POST_HOOKS["pyide_mpl"] = _no_blit
except ImportError:   # outside Toollib's worker (tests with plain Python)
    pass


def fill(code):
    return _PLACEHOLDER.sub(r"\1", code)


def _is_definition(stmt):
    if isinstance(stmt, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
        return True
    return isinstance(stmt, ast.Assign) and all(isinstance(t, ast.Name) and _CONSTANT.fullmatch(t.id) for t in stmt.targets)


def definitions_tree(code, filename="<snippet>"):
    """The definitions of a snippet with their original line numbers."""
    tree = ast.parse(fill(code), filename)
    tree.body = [stmt for stmt in tree.body if _is_definition(stmt)]
    return tree


def definitions(code):
    return ast.unparse(definitions_tree(code))


def _names(tree):
    """(names read, names bound) anywhere in a tree."""
    used, bound = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            (used if isinstance(node.ctx, ast.Load) else bound).add(node.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            bound.add(node.name)
        elif isinstance(node, ast.arg):
            bound.add(node.arg)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            bound.update((a.asname or a.name).split(".")[0] for a in node.names)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            bound.add(node.name)
        elif isinstance(node, (ast.MatchAs, ast.MatchStar)) and node.name:
            bound.add(node.name)
        elif isinstance(node, ast.MatchMapping) and node.rest:
            bound.add(node.rest)
    return used, bound


def _free_names():
    """Names the program or a definition reads but nobody binds (and that are not built in). Each definition
    counts on its own: its functions see the offered names, not the ones main.py imports."""
    free, offered = set(), set()
    for name, code in _pending:
        try:
            used, bound = _names(definitions_tree(code, name))
        except SyntaxError:
            continue
        free |= used - bound
        offered |= bound
    try:
        used, bound = _names(ast.parse(_main))
        free |= used - bound - offered
    except SyntaxError:
        pass   # run_file reports it
    return free - _BUILTIN_NAMES


def prepare(spec_json, run_dir):
    """spec: {"name": slug, "code": str, "deps": [[name, code], ...], "check": str or None}. Writes main.py."""
    global _main
    spec = json.loads(spec_json)
    _pending[:] = [(name, code) for name, code in spec.get("deps") or []]
    if spec.get("check") is not None:
        if spec.get("code"):
            _pending.append((spec.get("name") or "snippet", spec["code"]))
        _main = spec["check"]
    else:
        _main = fill(spec.get("code") or "")
    with open(os.path.join(run_dir, "main.py"), "w", encoding="utf-8") as f:
        f.write(_main if _main.endswith("\n") else _main + "\n")
    _autos[:] = sorted({AUTO[n] for n in _free_names() if n in AUTO})


def auto_imports():
    """The import lines Toollib adds for this run (JSON list)."""
    return json.dumps(_autos)


def needed_imports():
    """Top-level modules that main.py and the definitions import (JSON list), to load their packages first."""
    names = set()
    for code in [_main] + [fill(code) for _, code in _pending] + _autos:
        try:
            tree = ast.parse(code)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names.update(a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and not node.level:
                names.add(node.module.split(".")[0])
    return json.dumps(sorted(names))


def withdraw():
    """Takes back the names the last run offered."""
    for name, old in _offered.items():
        if old is _MISSING:
            builtins.__dict__.pop(name, None)
        else:
            builtins.__dict__[name] = old
    _offered.clear()


def define():
    """Runs the definitions and offers their names. False (with the traceback printed) if one of them fails."""
    withdraw()
    ns = {"__name__": "__main__", "__builtins__": builtins}
    for line in _autos:
        try:
            exec(line, ns)
        except Exception:
            pass   # the program then reports the missing name itself
    for name, code in _pending:
        source = fill(code)
        linecache.cache[name] = (len(source), None, source.splitlines(True), name)
        try:
            exec(compile(definitions_tree(code, name), name, "exec"), ns)
        except BaseException:
            pyide_runtime.print_user_traceback(*sys.exc_info())
            return False
    for name, value in ns.items():
        if name.startswith("__"):
            continue
        _offered[name] = builtins.__dict__.get(name, _MISSING)
        builtins.__dict__[name] = value
    return True
