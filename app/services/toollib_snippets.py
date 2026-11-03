"""Prepares what Toollib runs for a snippet.

main.py is exactly the code you see: the edited code ("Try it") or the check ("Run check"), so the line numbers
in a traceback match. The definitions it relies on run first: imports, functions, classes and UPPER_CASE
constants of the snippets named in the check's first line "# needs: a, b" and, for a check, of the snippet itself.
Their names are offered like built-ins: Python finds them whenever main.py does not define the name itself.
Each one runs under its own name (e.g. "lat-u1-links"), so an error inside it shows that name and its line.
Placeholders like ${x} or ${1:x} become their names. The same rules as check_nodes.py in Toollib's test folder,
which puts the same definitions in front of the check in one file.
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
_offered = {}    # name -> what builtins had before (or _MISSING)
_pending = []    # [(name, code)] of the run being prepared
_main = ""


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


def needed_imports():
    """Top-level modules that main.py and the definitions import (JSON list), to load their packages first."""
    names = set()
    for code in [_main] + [fill(code) for _, code in _pending]:
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
