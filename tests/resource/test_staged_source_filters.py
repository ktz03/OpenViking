# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Unit tests for filtered local-tree staging."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from openviking.resource.staged_source import _copy_local_tree


class _FakeVikingFS:
    def __init__(self) -> None:
        self.dirs: set[str] = set()
        self.files: dict[str, bytes] = {}

    async def mkdir(self, uri: str, exist_ok: bool = False, ctx=None) -> None:
        self.dirs.add(uri.rstrip("/"))

    async def write_file_bytes(self, uri: str, content: bytes, ctx=None) -> None:
        self.files[uri] = content


@pytest.mark.asyncio
async def test_copy_local_tree_honors_ignore_dirs_include_exclude(tmp_path: Path) -> None:
    root = tmp_path / "tree"
    (root / "docs").mkdir(parents=True)
    (root / "large-data").mkdir(parents=True)
    (root / "docs" / "keep.md").write_text("# keep\n", encoding="utf-8")
    (root / "docs" / "private.md").write_text("# private\n", encoding="utf-8")
    (root / "docs" / "skip.txt").write_text("nope\n", encoding="utf-8")
    (root / "large-data" / "ignored.bin").write_bytes(b"x" * 1024)

    fs = _FakeVikingFS()
    ctx = SimpleNamespace()
    await _copy_local_tree(
        root,
        "viking://temp/t/source/tree",
        fs,
        ctx,
        ignore_dirs="large-data",
        include="*.md",
        exclude="private*.md",
    )

    written = sorted(Path(uri).name for uri in fs.files)
    assert written == ["keep.md"]
    assert all("large-data" not in uri for uri in fs.files)
    assert all("ignored.bin" not in uri for uri in fs.files)
    assert all("private.md" not in uri for uri in fs.files)
    assert all("skip.txt" not in uri for uri in fs.files)
