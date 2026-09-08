# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: Apache-2.0
"""Regression tests for SkillPolicyUpdater merge_memory_fields (#4801)."""

from openviking.session.train.components.skill_policy_updater import (
    _apply_items_to_snapshot,
    _plan_to_resolved_operations,
)
from openviking.session.train.domain import PolicyPlanItem, PolicySet, PolicyUpdatePlan


def _upsert_item(*, description: str, content: str = "do the thing") -> PolicyPlanItem:
    return PolicyPlanItem(
        kind="upsert",
        memory_type="skills",
        target_name="markdown-release-check",
        target_uri="",
        before_content=None,
        after_content=content,
        confidence=1.0,
        metadata={
            "merge_memory_fields": {
                "skill_name": "markdown-release-check",
                "description": description,
                "content": content,
            }
        },
    )


def test_apply_items_preserves_description_from_merge_memory_fields():
    """New Skills must keep optimizer-extracted description (#4801)."""
    policy_set = PolicySet(root_uri="viking://agent/skills", policies=[])
    updated = _apply_items_to_snapshot([_upsert_item(description="Validate Markdown frontmatter")], policy_set)

    assert len(updated.policies) == 1
    assert updated.policies[0].metadata.get("description") == "Validate Markdown frontmatter"


def test_plan_to_resolved_operations_forwards_merge_description():
    policy_set = PolicySet(root_uri="viking://agent/skills", policies=[])
    plan = PolicyUpdatePlan(items=[_upsert_item(description="中文描述也要保留")])
    updated = _apply_items_to_snapshot(plan.items, policy_set)
    ops = _plan_to_resolved_operations(
        plan=plan,
        policy_set=policy_set,
        updated_policy_set=updated,
    )

    assert len(ops.upsert_operations) == 1
    assert ops.upsert_operations[0].memory_fields.get("description") == "中文描述也要保留"


def test_patch_metadata_still_overrides_merge_memory_fields():
    item = _upsert_item(description="from-merge")
    item.metadata["patch_metadata"] = {"description": "from-patch"}
    policy_set = PolicySet(root_uri="viking://agent/skills", policies=[])
    updated = _apply_items_to_snapshot([item], policy_set)
    assert updated.policies[0].metadata.get("description") == "from-patch"
