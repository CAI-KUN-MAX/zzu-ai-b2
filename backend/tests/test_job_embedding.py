import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
import httpx
from openai import APIStatusError

from app.job_embedding import EmbeddingError, apply, similarities


class EmbeddingTests(unittest.IsolatedAsyncioTestCase):
    async def test_batches_validate_and_combine_vectors(self):
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.embeddings.create = AsyncMock(return_value=SimpleNamespace(data=[
            SimpleNamespace(index=1, embedding=[0.0, 1.0] + [0.0] * 1022),
            SimpleNamespace(index=0, embedding=[1.0, 0.0] + [0.0] * 1022),
            SimpleNamespace(index=2, embedding=[1.0, 0.0] + [0.0] * 1022),
        ]))
        with patch.dict(os.environ, {"ZHIPUAI_API_KEY": "test"}), patch("app.job_embedding.AsyncOpenAI", return_value=client):
            values = await similarities("resume", [{"jd_text": "first"}, {"jd_text": "second"}], asyncio.Semaphore(1))
        self.assertEqual(values, [0.0, 1.0])
        self.assertEqual(client.embeddings.create.await_args.kwargs["model"], "embedding-3")
        self.assertEqual(client.embeddings.create.await_args.kwargs["dimensions"], 1024)

    async def test_invalid_vectors_and_oversized_inputs_fail_safely(self):
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.embeddings.create = AsyncMock(return_value=SimpleNamespace(data=[
            SimpleNamespace(index=0, embedding=[float("nan")]),
            SimpleNamespace(index=1, embedding=[1.0]),
        ]))
        with patch.dict(os.environ, {"ZHIPUAI_API_KEY": "test"}), patch("app.job_embedding.AsyncOpenAI", return_value=client):
            with self.assertRaisesRegex(EmbeddingError, "invalid_vector"):
                await similarities("resume", [{"jd_text": "job"}], asyncio.Semaphore(1))
            with self.assertRaisesRegex(EmbeddingError, "input_too_large"):
                await similarities("x" * (512 * 256), [{"jd_text": "job"}], asyncio.Semaphore(1))

    def test_ties_and_single_job_use_neutral_percentile(self):
        items = [{"job_id": "a", "rule_score": 60}, {"job_id": "b", "rule_score": 60}]
        jobs = [{"job_id": "a"}, {"job_id": "b"}]
        apply(items, jobs, [0.5, 0.5])
        self.assertEqual([item["stage1_score"] for item in items], [58, 58])
        apply(items[:1], jobs[:1], [0.5])
        self.assertEqual(items[0]["stage1_score"], 58)

    async def test_provider_error_codes_are_distinguished(self):
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        for status, code, expected in [(429, "1113", "insufficient_balance"),
                                       (429, "1302", "rate_limited"),
                                       (401, "1000", "authentication_failed")]:
            request = httpx.Request("POST", "https://example.invalid")
            response = httpx.Response(status, request=request)
            client.embeddings.create = AsyncMock(side_effect=APIStatusError(
                "provider error", response=response, body={"error": {"code": code}}))
            with patch.dict(os.environ, {"ZHIPUAI_API_KEY": "test"}), patch("app.job_embedding.AsyncOpenAI", return_value=client):
                with self.assertRaisesRegex(EmbeddingError, expected):
                    await similarities("resume", [{"jd_text": "job"}], asyncio.Semaphore(1))

    async def test_missing_key_and_invalid_dimensions(self):
        with patch.dict(os.environ, {"ZHIPUAI_API_KEY": ""}):
            with self.assertRaisesRegex(EmbeddingError, "authentication_failed"):
                await similarities("resume", [{"jd_text": "job"}], asyncio.Semaphore(1))
        from app.job_embedding import combine
        with self.assertRaisesRegex(EmbeddingError, "invalid_vector"):
            combine([[1.0] * 2048], [1])
