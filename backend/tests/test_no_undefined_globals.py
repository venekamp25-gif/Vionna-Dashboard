# -*- coding: utf-8 -*-
"""A name a function reads must exist in its module.

30 Sep 2026: fix/blog-dk-handle moved the writer → create body out of
_blog_generate_one into _blog_write_and_publish, and fix/blog-writer-format
changed the writer-failed block to fall through with `candidates`. Git merged
that hunk into the new function without a conflict, the module imported fine,
and only at runtime did every writer failure become
`NameError: name 'candidates' is not defined`: the fall-through, the real
reason and the /api/blog/generate result were gone. Parallel fix branches are
merged together at integration, so this check reads every function's global
lookups from the bytecode and turns such a silent semantic conflict into one
red test that names the function and the missing name.
"""
import builtins
import dis
import importlib
import types

import pytest

MODULES = ['server', 'shipping_check']


def _code_objects(co):
    yield co
    for c in co.co_consts:
        if isinstance(c, types.CodeType):
            yield from _code_objects(c)


def _global_reads(src, filename):
    """{name: {qualified function names}} for every LOAD_GLOBAL in the source,
    nested functions, lambdas and methods included."""
    reads = {}
    for co in _code_objects(compile(src, filename, 'exec')):
        for ins in dis.get_instructions(co):
            if ins.opname == 'LOAD_GLOBAL':
                reads.setdefault(ins.argval, set()).add(co.co_qualname)
    return reads


def _undefined(module, reads):
    # A name that only a `global` statement inside some function creates is not
    # accepted either: any reader that runs before that function raises too.
    known = set(vars(module)) | set(dir(builtins))
    return {n: sorted(fns) for n, fns in reads.items() if n not in known}


@pytest.mark.parametrize('name', MODULES)
def test_every_global_name_a_function_reads_exists_in_its_module(name):
    module = importlib.import_module(name)
    with open(module.__file__, encoding='utf-8') as f:
        missing = _undefined(module, _global_reads(f.read(), module.__file__))
    assert missing == {}, f'{name}.py reads names it never defines: {missing}'


def test_the_check_catches_the_candidates_name_the_writer_merge_left_behind():
    import server

    merged = (
        "def _blog_write_and_publish(store, topic, products, hdrs, published):\n"
        "    rest = [c for c in candidates if c is not topic]\n"
        "    return _blog_generate_one(store, published=published, _candidates=rest)\n"
    )
    assert _undefined(server, _global_reads(merged, '<merged>')) == {
        'candidates': ['_blog_write_and_publish']}
