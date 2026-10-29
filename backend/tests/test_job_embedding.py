import asyncio
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.job_embedding import EmbeddingError, apply, similarities


class EmbeddingTests(unittest.IsolatedAsyncioTestCase):
    async def test_batches_validate_and_combine_vectors(self):
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.embeddings.create = AsyncMock(return_value=SimpleNamespace(data=[
            SimpleNamespace(index=1, embedding=[0.0, 1.0]),
            SimpleNamespace(index=0, embedding=[1.0, 0.0]),
            SimpleNamespace(index=2, embedding=[1.0, 0.0]),
        ]))
        with patch.dict(os.environ, {"LLM_API_KEY": "test"}), patch("app.job_embedding.AsyncOpenAI", return_value=client):
            values = await similarities("resume", [{"jd_text": "first"}, {"jd_text": "second"}], asyncio.Semaphore(1))
        self.assertEqual(values, [0.0, 1.0])
        self.assertEqual(client.embeddings.create.await_args.kwargs["model"], "embedding-3")

    async def test_invalid_vectors_and_oversized_inputs_fail_safely(self):
        client = MagicMock()
        client.__aenter__ = AsyncMock(return_value=client)
        client.__aexit__ = AsyncMock(return_value=False)
        client.embeddings.create = AsyncMock(return_value=SimpleNamespace(data=[
            SimpleNamespace(index=0, embedding=[float("nan")]),
            SimpleNamespace(index=1, embedding=[1.0]),
        ]))
        with patch.dict(os.environ, {"LLM_API_KEY": "test"}), patch("app.job_embedding.AsyncOpenAI", return_value=client):
            with self.assertRaisesRegex(EmbeddingError, "unavailable"):
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
