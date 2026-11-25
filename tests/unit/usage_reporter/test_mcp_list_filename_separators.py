# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0

import asyncio

import pytest
from openviking.message import Message, ToolPart
from openviking.usage_reporter import MemoryUsageExtractor, UsageContext

PARENT = "viking://user/test/memories/experiences"


def extract_list_events(tool_name, output, *, include_tags=False, recursive=False):
    context = UsageContext(
        account_id="test",
        user_id="test",
        session_id="s1",
        archive_uri="viking://user/test/sessions/s1/history/archive_001",
    )
    part = ToolPart(
        tool_id="list-1",
        tool_name=tool_name,
        tool_input={"uri": PARENT, "include_tags": include_tags, "recursive": recursive},
        tool_output=output,
        tool_status="completed",
    )
    message = Message(
        id="message-1",
        role="user",
        parts=[part],
        created_at="2026-11-25T03:00:00Z",
    )
    return asyncio.run(MemoryUsageExtractor().extract(messages=[message], context=context))


@pytest.mark.parametrize(
    "tool_name",
    [
        "list",
        "mcp__openviking__list",
        "mcp__plugin_openviking-memory_openviking__list",
        " list ",
        " mcp__openviking__list ",
        " mcp__plugin_openviking-memory_openviking__list ",
    ],
)
@pytest.mark.parametrize("include_tags", [False, True])
@pytest.mark.parametrize("recursive", [False, True])
def test_mcp_list_retains_dash_in_real_filename(tool_name, include_tags, recursive):
    uri = f"{PARENT}/order - refund.md"
    label = uri if recursive else "order - refund.md"
    suffix = ' tags=["team=search"]' if include_tags else ""
    events = extract_list_events(
        tool_name, f"[file] {label}{suffix}", include_tags=include_tags, recursive=recursive
    )
    assert [event.resource_uri for event in events] == [uri]


def test_mcp_list_still_handles_ordinary_filename():
    events = extract_list_events("mcp__openviking__list", "[file] ordinary.md")
    assert [event.resource_uri for event in events] == [f"{PARENT}/ordinary.md"]


def test_untagged_mcp_list_keeps_tag_shaped_filename():
    events = extract_list_events("mcp__openviking__list", "[file] notes tags=[]")
    assert [event.resource_uri for event in events] == [f"{PARENT}/notes tags=[]"]


def test_openclaw_list_still_removes_its_summary():
    uri = f"{PARENT}/normal.md"
    events = extract_list_events("ov_list", f"[file] {uri} - useful summary")
    assert [event.resource_uri for event in events] == [uri]


@pytest.mark.parametrize("include_tags", [False, True])
def test_padded_mcp_tool_name_keeps_tag_shaped_filename(include_tags):
    uri = f"{PARENT}/case - review tags=[]"
    suffix = ' tags=["team=search"]' if include_tags else ""
    events = extract_list_events(
        " mcp__openviking__list ",
        f"[file] case - review tags=[]{suffix}",
        include_tags=include_tags,
    )
    assert [event.resource_uri for event in events] == [uri]
