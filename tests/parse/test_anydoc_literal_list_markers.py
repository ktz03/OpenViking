# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Preserve paragraph structure when native text resembles an ordered-list marker."""

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

import pytest

from openviking.parse.parsers.anydoc_converter import AnyDocConverter

MarkdownIt = pytest.importorskip("markdown_it", reason="CommonMark structure oracle").MarkdownIt


def _write_epub(path: Path, body: str) -> None:
    chapter = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml">'
        "<head><title>Literal markers</title></head><body>"
        f"{body}</body></html>"
    )
    package = (
        '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" '
        'unique-identifier="book-id">'
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:identifier id="book-id">literal-markers</dc:identifier>'
        "<dc:title>Literal markers</dc:title><dc:language>en</dc:language>"
        '</metadata><manifest><item id="chapter" href="chapter.xhtml" '
        'media-type="application/xhtml+xml"/></manifest>'
        '<spine><itemref idref="chapter"/></spine></package>'
    )
    container = (
        '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'
        '<rootfiles><rootfile full-path="OPS/content.opf" '
        'media-type="application/oebps-package+xml"/></rootfiles></container>'
    )
    with ZipFile(path, "w") as archive:
        archive.writestr("mimetype", "application/epub+zip", compress_type=ZIP_STORED)
        for name, content in (
            ("META-INF/container.xml", container),
            ("OPS/content.opf", package),
            ("OPS/chapter.xhtml", chapter),
        ):
            archive.writestr(name, content, compress_type=ZIP_DEFLATED)


@pytest.mark.parametrize(
    "text",
    [
        "1. literal paragraph",
        "2) literal paragraph",
        "12. literal paragraph",
        "12) literal paragraph",
        "0. literal paragraph",
        "999999999. literal paragraph",
        "1.",
    ],
)
def test_epub_numbered_paragraph_stays_a_paragraph(tmp_path: Path, text: str):
    pytest.importorskip("anydoc")
    source = tmp_path / "literal-marker.epub"
    _write_epub(source, f"<p>{text}</p>")

    result = AnyDocConverter().convert(
        source, resource_name="literal-marker", storage=None, format_hint="epub"
    )
    tokens = MarkdownIt().parse(result.markdown)

    assert not any(token.type == "ordered_list_open" for token in tokens)
    assert any(
        token.type == "inline" and "".join(child.content for child in token.children or []) == text
        for token in tokens
    )


@pytest.mark.parametrize(
    "body",
    [
        "<p>1. <strong>literal paragraph</strong></p>",
        "<p>Before<br/>1. literal line</p>",
        "<blockquote><p>1. literal paragraph</p></blockquote>",
        "<ul><li><p>1. literal paragraph</p></li></ul>",
    ],
    ids=["styled-following", "hard-break", "quote", "inside-real-bullet-list"],
)
def test_epub_numbered_text_keeps_container_structure(tmp_path: Path, body: str):
    pytest.importorskip("anydoc")
    source = tmp_path / "literal-container.epub"
    _write_epub(source, body)

    result = AnyDocConverter().convert(
        source, resource_name="literal-container", storage=None, format_hint="epub"
    )
    tokens = MarkdownIt().parse(result.markdown)

    assert not any(token.type == "ordered_list_open" for token in tokens)
    assert "literal" in result.markdown


@pytest.mark.parametrize(
    ("body", "expected", "ordered", "bullets"),
    [
        ("<p>Before 1. literal</p>", "Before 1. literal", 0, 0),
        ("<p>1.literal</p>", "1.literal", 0, 0),
        ("<p>1234567890. literal</p>", "1234567890. literal", 0, 0),
        ("<p>\u0661. literal</p>", "\u0661. literal", 0, 0),
        ("<ol><li>real item</li></ol>", "1. real item", 1, 0),
        ("<ul><li>real item</li></ul>", "- real item", 0, 1),
        ("<h1>1. heading</h1>", "# 1. heading", 0, 0),
        (
            '<p><a href="https://example.org/">1. label</a></p>',
            "[1. label](https://example.org/)",
            0,
            0,
        ),
        ("<p><code>1. code</code></p>", "`1. code`", 0, 0),
        ("<p><strong>1. strong</strong></p>", "**1. strong**", 0, 0),
        (
            "<ol><li>first item</li><li>next item</li></ol>",
            "2. next item",
            1,
            0,
        ),
    ],
)
def test_epub_existing_lists_and_nonmarkers_keep_behavior(
    tmp_path: Path, body: str, expected: str, ordered: int, bullets: int
):
    pytest.importorskip("anydoc")
    source = tmp_path / "marker-control.epub"
    _write_epub(source, body)

    result = AnyDocConverter().convert(
        source, resource_name="marker-control", storage=None, format_hint="epub"
    )
    tokens = MarkdownIt().parse(result.markdown)

    assert expected in result.markdown
    assert sum(token.type == "ordered_list_open" for token in tokens) == ordered
    assert sum(token.type == "bullet_list_open" for token in tokens) == bullets
