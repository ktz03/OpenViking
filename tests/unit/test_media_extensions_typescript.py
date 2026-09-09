#!/usr/bin/env python3
# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0

"""TypeScript .ts must not be classified as video (#3266)."""

from openviking.parse.parsers.media.constants import MEDIA_EXTENSIONS, VIDEO_EXTENSIONS


def test_typescript_extension_is_not_video():
    assert ".ts" not in VIDEO_EXTENSIONS
    assert ".ts" not in MEDIA_EXTENSIONS


def test_mpeg_ts_uses_dedicated_extensions():
    assert ".mts" in VIDEO_EXTENSIONS
    assert ".m2ts" in VIDEO_EXTENSIONS
