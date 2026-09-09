# Copyright (c) 2026 Beijing Volcano Engine Technology Co., Ltd.
# SPDX-License-Identifier: AGPL-3.0
"""Constants for media parsers."""

# Image extensions supported by ImageParser
IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tiff", ".tif", ".ico", ".dib", ".icns", ".sgi", ".jp2"]

# Audio extensions supported by AudioParser
AUDIO_EXTENSIONS = [".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".opus", ".ac3"]

# Video extensions supported by VideoParser.
# Do not include ".ts" — that extension is TypeScript source (#3266), not MPEG-TS.
# Prefer ".mts" / ".m2ts" for MPEG transport streams.
VIDEO_EXTENSIONS = [".mp4", ".avi", ".mov", ".mkv", ".webm", ".flv", ".wmv", ".mts", ".m2ts"]

# All media extensions combined
MEDIA_EXTENSIONS = set(IMAGE_EXTENSIONS + AUDIO_EXTENSIONS + VIDEO_EXTENSIONS)
