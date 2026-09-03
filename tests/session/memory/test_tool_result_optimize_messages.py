# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0

import json

from openviking.session.memory.tools import (
    add_tool_call_pair_to_messages,
    optimize_tool_result,
)


def test_optimize_tool_result_truncates_read_content():
    long_content = "\n".join(f"{i}\t" for i in range(1, 900))
    result = {"uri": "viking://user/u/memories/profile.md", "content": long_content}
    optimized = optimize_tool_result("read", result)
    assert isinstance(optimized, dict)
    assert "content" in optimized
    assert len(optimized["content"]) < len(long_content)
    assert "truncated" in optimized["content"]
    # Original must stay untouched
    assert len(result["content"]) == len(long_content)


def test_add_tool_call_pair_uses_optimized_read_result():
    long_content = "\n".join(f"{i}\t" for i in range(1, 900))
    original = {"uri": "viking://user/u/memories/profile.md", "content": long_content}
    messages = []
    add_tool_call_pair_to_messages(
        messages,
        call_id="call_1",
        tool_name="read",
        params={"uri": original["uri"]},
        result=original,
    )
    assert len(messages) == 1
    payload = json.loads(messages[0]["content"])
    assert payload["tool_call_name"] == "read"
    assert len(payload["result"]["content"]) < len(long_content)
    assert "truncated" in payload["result"]["content"]
    # Caller-held original remains full for apply/write paths
    assert len(original["content"]) == len(long_content)
