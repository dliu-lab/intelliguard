from __future__ import annotations

import asyncio
import json
from urllib.error import URLError

from intelliguard.evaluation.judge import run_judge


def test_judge_returns_review_when_not_configured(monkeypatch) -> None:
    monkeypatch.delenv("JUDGE_PROVIDER", raising=False)
    monkeypatch.delenv("JUDGE_ENDPOINT", raising=False)
    monkeypatch.delenv("JUDGE_MODEL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_CHAT_COMPLETIONS_URL", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    result = asyncio.run(run_judge("response_quality", {"response": "test response"}))
    assert result.status == "REVIEW"
    assert result.criterion_name == "response_quality"
    assert result.judge_model is None
    assert result.score == 50


def test_judge_calls_openai_compatible_endpoint(monkeypatch) -> None:
    monkeypatch.delenv("JUDGE_PROVIDER", raising=False)
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "choices": [
                        {
                            "message": {
                                "content": json.dumps(
                                    {
                                        "status": "PASS",
                                        "score": 92,
                                        "evidence_sentence": "The response is grounded and complete.",
                                    }
                                )
                            }
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("intelliguard.evaluation.judge.urlopen", fake_urlopen)

    result = asyncio.run(
        run_judge(
            "response_quality",
            {"response": "Approved answer."},
            {
                "endpoint": "http://judge.local/v1/chat/completions",
                "model": "judge-model",
                "api_key": "secret-token",
                "prompt_version": "response-v1",
                "timeout_seconds": 7,
            },
        )
    )

    assert result.status == "PASS"
    assert result.score == 92
    assert result.evidence_sentence == "The response is grounded and complete."
    assert result.judge_model == "judge-model"
    assert result.prompt_version == "response-v1"
    assert captured["url"] == "http://judge.local/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer secret-token"
    assert captured["body"]["model"] == "judge-model"
    assert "response_quality" in captured["body"]["messages"][1]["content"]
    assert captured["timeout"] == 7


def test_judge_calls_local_ollama_chat_endpoint(monkeypatch) -> None:
    monkeypatch.delenv("OLLAMA_CHAT_URL", raising=False)
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def read(self) -> bytes:
            return json.dumps(
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "status": "PASS",
                                "score": 88,
                                "evidence_sentence": "The local judge approved the evidence.",
                            }
                        )
                    }
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["headers"] = dict(request.header_items())
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr("intelliguard.evaluation.judge.urlopen", fake_urlopen)

    result = asyncio.run(
        run_judge(
            "response_quality",
            {"response": "Approved answer."},
            {
                "provider": "ollama",
                "base_url": "http://localhost:11434",
                "model": "qwen3.5:9b",
                "timeout_seconds": 5,
            },
        )
    )

    assert result.status == "PASS"
    assert result.score == 88
    assert result.evidence_sentence == "The local judge approved the evidence."
    assert result.judge_model == "qwen3.5:9b"
    assert captured["url"] == "http://localhost:11434/api/chat"
    assert captured["headers"]["Content-type"] == "application/json"
    assert captured["body"]["model"] == "qwen3.5:9b"
    assert captured["body"]["stream"] is False
    assert captured["body"]["options"]["temperature"] == 0
    assert "response_quality" in captured["body"]["messages"][1]["content"]
    assert captured["timeout"] == 5


def test_judge_network_error_returns_review(monkeypatch) -> None:
    monkeypatch.delenv("JUDGE_PROVIDER", raising=False)

    def fake_urlopen(_request, timeout=None):
        _ = timeout
        raise URLError("connection refused")

    monkeypatch.setattr("intelliguard.evaluation.judge.urlopen", fake_urlopen)

    result = asyncio.run(
        run_judge(
            "response_quality",
            {"response": "test"},
            {"endpoint": "http://judge.local/v1/chat/completions", "model": "judge-model"},
        )
    )

    assert result.status == "REVIEW"
    assert result.score == 50
    assert "Judge request failed" in result.evidence_sentence
