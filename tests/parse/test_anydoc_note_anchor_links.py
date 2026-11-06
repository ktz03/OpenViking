# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Retain DOCX bookmark links regardless of whether the referring link is in a note."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from openviking.parse.parsers.anydoc_converter import AnyDocConverter


def _write_note_link_docx(
    path: Path, note_kind: str, target_location: str, link_location: str
) -> None:
    word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    rels = "http://schemas.openxmlformats.org/package/2006/relationships"
    office = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
    bookmark = (
        '<w:bookmarkStart w:id="8" w:name="target"/>'
        "<w:r><w:t>Target paragraph</w:t></w:r>"
        '<w:bookmarkEnd w:id="8"/>'
    )
    body = "<w:p>" + bookmark + "</w:p>" if target_location == "body" else ""
    if link_location in {"body", "both"}:
        body += (
            '<w:p><w:hyperlink w:anchor="target"><w:r>'
            "<w:t>Jump from body</w:t></w:r></w:hyperlink></w:p>"
        )
    body += (
        f'<w:p><w:r><w:t>Reference</w:t></w:r><w:r><w:{note_kind}Reference w:id="1"/></w:r></w:p>'
    )
    note_body = bookmark if target_location == "note" else ""
    note_body += (
        '<w:hyperlink w:anchor="target"><w:r><w:t>Jump from note</w:t></w:r></w:hyperlink>'
        if link_location in {"note", "both"}
        else "<w:r><w:t>Plain note</w:t></w:r>"
    )
    document = f'<w:document xmlns:w="{word}"><w:body>{body}</w:body></w:document>'
    notes = (
        f'<w:{note_kind}s xmlns:w="{word}"><w:{note_kind} w:id="1">'
        f"<w:p>{note_body}</w:p></w:{note_kind}></w:{note_kind}s>"
    )
    package = (
        f'<Relationships xmlns="{rels}"><Relationship Id="doc" '
        f'Type="{office}officeDocument" Target="word/document.xml"/></Relationships>'
    )
    doc_rels = (
        f'<Relationships xmlns="{rels}"><Relationship Id="notes" '
        f'Type="{office}{note_kind}s" Target="{note_kind}s.xml"/></Relationships>'
    )
    types = (
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" '
        'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.'
        'wordprocessingml.document.main+xml"/>'
        f'<Override PartName="/word/{note_kind}s.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.'
        f'wordprocessingml.{note_kind}s+xml"/></Types>'
    )
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in (
            ("[Content_Types].xml", types),
            ("_rels/.rels", package),
            ("word/document.xml", document),
            ("word/_rels/document.xml.rels", doc_rels),
            (f"word/{note_kind}s.xml", notes),
        ):
            archive.writestr(name, content)


@pytest.mark.parametrize("note_kind", ["footnote", "endnote"])
@pytest.mark.parametrize("target_location", ["body", "note"])
@pytest.mark.parametrize("link_location", ["body", "note", "both"])
def test_docx_note_anchor_links_do_not_depend_on_body_links(
    tmp_path: Path, note_kind: str, target_location: str, link_location: str
):
    pytest.importorskip("anydoc")
    source = tmp_path / "note-links.docx"
    _write_note_link_docx(source, note_kind, target_location, link_location)

    result = AnyDocConverter().convert(
        source, resource_name="note-links", storage=None, format_hint="docx"
    )

    assert '<a id="target"></a>' in result.markdown
    assert "[^1]" in result.markdown
    if link_location in {"body", "both"}:
        assert "[Jump from body](#target)" in result.markdown
    if link_location in {"note", "both"}:
        assert "[Jump from note](#target)" in result.markdown
    else:
        assert "Plain note" in result.markdown
