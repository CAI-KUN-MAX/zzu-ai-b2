"""Bounded cloud embeddings for one-resume-to-many-jobs ranking."""
import asyncio
import math
import os

from openai import AsyncOpenAI, APITimeoutError, RateLimitError

MODEL = "embedding-3"
BASE_URL = "https://open.bigmodel.cn/api/paas/v4/"
CHUNK_SIZE = 512
MAX_CHUNKS = 256
BATCH_SIZE = 64
TIMEOUT = 30


class EmbeddingError(Exception):
    pass


def chunks(text):
    return [text[i:i + CHUNK_SIZE] for i in range(0, len(text), CHUNK_SIZE)]


def combine(vectors, lengths):
    if not vectors or not vectors[0] or any(len(v) != len(vectors[0]) for v in vectors):
        raise EmbeddingError("unavailable")
    if any(not math.isfinite(x) for v in vectors for x in v):
        raise EmbeddingError("unavailable")
    total = sum(lengths)
    result = [sum(v[i] * n for v, n in zip(vectors, lengths)) / total for i in range(len(vectors[0]))]
    norm = math.sqrt(sum(x * x for x in result))
    if not norm or not math.isfinite(norm):
        raise EmbeddingError("unavailable")
    return [x / norm for x in result]


async def similarities(resume, jobs, gate):
    texts = [resume] + [job["jd_text"] for job in jobs]
    groups = [chunks(text) for text in texts]
    flat = [chunk for group in groups for chunk in group]
    if not all(groups) or len(flat) > MAX_CHUNKS:
        raise EmbeddingError("input_too_large")
    key = os.getenv("LLM_API_KEY", "").strip()
    if not key:
        raise EmbeddingError("unavailable")
    try:
        async with asyncio.timeout(TIMEOUT):
            async with gate:
                async with AsyncOpenAI(api_key=key, base_url=BASE_URL, timeout=TIMEOUT, max_retries=0) as client:
                    vectors = []
                    for offset in range(0, len(flat), BATCH_SIZE):
                        batch = flat[offset:offset + BATCH_SIZE]
                        response = await client.embeddings.create(model=MODEL, input=batch)
                        data = sorted(response.data, key=lambda item: item.index)
                        if [item.index for item in data] != list(range(len(batch))):
                            raise EmbeddingError("unavailable")
                        vectors.extend(item.embedding for item in data)
        result = []
        offset = 0
        for group in groups:
            result.append(combine(vectors[offset:offset + len(group)], [len(text) for text in group]))
            offset += len(group)
        if any(len(vector) != len(result[0]) for vector in result):
            raise EmbeddingError("unavailable")
        return [max(-1.0, min(1.0, sum(a * b for a, b in zip(result[0], vector)))) for vector in result[1:]]
    except (TimeoutError, APITimeoutError):
        raise EmbeddingError("timeout") from None
    except RateLimitError:
        raise EmbeddingError("rate_limited") from None
    except EmbeddingError:
        raise
    except Exception:
        raise EmbeddingError("unavailable") from None


def apply(items, jobs, values):
    by_id = dict(zip((job["job_id"] for job in jobs), values))
    for item in items:
        similarity = by_id[item["job_id"]]
        greater = sum(value > similarity for value in values)
        equal = sum(value == similarity for value in values)
        percentile = 50 if len(values) == 1 else 100 * (len(values) - 1 - greater - (equal - 1) / 2) / (len(values) - 1)
        item["embedding_similarity"] = similarity
        item["stage1_score"] = round(.8 * item["rule_score"] + .2 * percentile)
        item["score"] = item["stage1_score"]
