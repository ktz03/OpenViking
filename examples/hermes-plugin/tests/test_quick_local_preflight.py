"""LLM preflight retries and diagnostics through the external package."""

import contextlib
import importlib
import io
import json
import os
import subprocess
import sys
import types
from unittest.mock import MagicMock

import httpx
import pytest


@pytest.fixture
def ql(external_provider):
    _home, _provider, module, _settings = external_provider("preflight")
    return importlib.import_module(module.__name__ + ".quick_local")


@pytest.mark.parametrize("status,retries", [(401, False), (404, False), (429, True), (500, True)])
def test_preflight_script_retries_only_transient_errors(ql, tmp_path, monkeypatch, status, retries):
    import openai

    error = openai.APIStatusError(
        "secret response body", response=httpx.Response(status, request=httpx.Request("POST", "https://test")),
        body=None,
    )
    _check_script(ql, tmp_path, monkeypatch, error, retries)


@pytest.mark.parametrize("error,retries", [
    (httpx.ReadTimeout("secret timeout text"), True),
    (TimeoutError("secret timeout text"), True),
    (ValueError("secret error text"), False),
])
def test_preflight_script_timeout_and_other_errors(ql, tmp_path, monkeypatch, error, retries):
    _check_script(ql, tmp_path, monkeypatch, error, retries)


def test_preflight_does_not_retry_connection_errors(ql, tmp_path, monkeypatch):
    import openai

    _check_script(ql, tmp_path, monkeypatch,
                  openai.APIConnectionError(request=httpx.Request("POST", "https://test")), False)


def test_preflight_sdk_timeout_stops_after_one_retry(ql, tmp_path, monkeypatch):
    import openai

    _check_script(ql, tmp_path, monkeypatch,
                  openai.APITimeoutError(request=httpx.Request("POST", "https://test")), True,
                  succeeds=False)


def _check_script(ql, tmp_path, monkeypatch, error, retries, succeeds=True):
    """Execute the shipped child script, replacing only the LLM backend."""
    paths = ql.managed_paths(tmp_path)
    config = tmp_path / "check.json"
    config.write_text(json.dumps({"vlm": {"model": "test"}}), encoding="utf-8")
    vlm = MagicMock()
    vlm.get_completion.side_effect = [error, "OK" if succeeds else error]
    factory = MagicMock()
    factory.create.return_value = vlm
    backend = types.ModuleType("openviking.models.vlm")
    backend.VLMFactory = factory
    monkeypatch.setitem(sys.modules, "openviking.models.vlm", backend)
    monkeypatch.setattr(sys, "argv", ["check", str(config)])
    import time

    sleep = MagicMock()
    monkeypatch.setattr(time, "sleep", sleep)

    def run(command, **_kwargs):
        output = io.StringIO()
        code = 0
        with contextlib.redirect_stdout(output):
            try:
                exec(compile(command[2], "<llm-preflight>", "exec"), {})
            except SystemExit as exc:
                code = exc.code
        return subprocess.CompletedProcess(command, code, stdout=output.getvalue(), stderr="secret stderr")

    monkeypatch.setattr(ql.subprocess, "run", run)
    if retries and succeeds:
        ql._validate_vlm(paths, config)
    else:
        with pytest.raises(ql.QuickLocalSetupError) as caught:
            ql._validate_vlm(paths, config)
        assert "secret" not in str(caught.value)
    assert vlm.get_completion.call_count == (2 if retries else 1)
    if retries:
        sleep.assert_called_once_with(1)
    else:
        sleep.assert_not_called()


@pytest.mark.parametrize("failure,expected", [
    ({"error": "AuthenticationError", "status": 401}, "API key and its permissions"),
    ({"error": "NotFoundError", "status": 404}, "model and endpoint"),
    ({"error": "RateLimitError", "status": 429, "attempts": 2}, "rate-limiting"),
    ({"error": "InternalServerError", "status": 500, "attempts": 2}, "temporary server error"),
    ({"error": "APITimeoutError", "timeout": True, "attempts": 2}, "timed out"),
])
def test_failure_metadata_is_actionable_and_private(ql, tmp_path, monkeypatch, failure, expected):
    result = subprocess.CompletedProcess("check", 1,
                                         stdout="import notice\n" + json.dumps(failure),
                                         stderr="Bearer secret credential")
    monkeypatch.setattr(ql.subprocess, "run", lambda *_args, **_kwargs: result)
    with pytest.raises(ql.QuickLocalSetupError, match=expected) as caught:
        ql._validate_vlm(ql.managed_paths(tmp_path), tmp_path / "check.json")
    log = tmp_path / "logs/openviking-server.log"
    assert failure["error"] in str(caught.value) and failure["error"] in log.read_text()
    assert "secret" not in str(caught.value) and "secret" not in log.read_text()
    if failure.get("status"):
        assert f"HTTP {failure['status']}" in str(caught.value)
    if os.name != "nt":
        assert log.stat().st_mode & 0o777 == 0o600


def test_unstructured_failure_never_exposes_child_output(ql, tmp_path, monkeypatch):
    result = subprocess.CompletedProcess("check", 1, stdout="secret credential", stderr="secret response")
    monkeypatch.setattr(ql.subprocess, "run", lambda *_args, **_kwargs: result)
    with pytest.raises(ql.QuickLocalSetupError, match="UnknownError") as caught:
        ql._validate_vlm(ql.managed_paths(tmp_path), tmp_path / "check.json")
    assert "secret" not in str(caught.value)
    assert "secret" not in (tmp_path / "logs/openviking-server.log").read_text()
