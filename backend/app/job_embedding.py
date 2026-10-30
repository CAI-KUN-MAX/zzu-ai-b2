"""Bounded cloud embeddings for one-resume-to-many-jobs ranking."""
import asyncio
import math
import os

from openai import AsyncOpenAI, APITimeoutError, APIStatusError

MODEL = "embedding-3"
DIMENSIONS = 1024
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
    if not vectors or any(len(v) != DIMENSIONS for v in vectors):
        raise EmbeddingError("invalid_vector")
    if any(not math.isfinite(x) for v in vectors for x in v):
        raise EmbeddingError("invalid_vector")
    total = sum(lengths)
    result = [sum(v[i] * n for v, n in zip(vectors, lengths)) / total for i in range(len(vectors[0]))]
    norm = math.sqrt(sum(x * x for x in result))
    if not norm or not math.isfinite(norm):
        raise EmbeddingError("invalid_vector")
    return [x / norm for x in result]


async def similarities(resume, jobs, gate, *, usage=None, batch_size=BATCH_SIZE):
    texts = [resume] + [job["jd_text"] for job in jobs]
    groups = [chunks(text) for text in texts]
    flat = [chunk for group in groups for chunk in group]
    if not all(groups) or len(flat) > MAX_CHUNKS:
        raise EmbeddingError("input_too_large")
    key = os.getenv("ZHIPUAI_API_KEY", "").strip()
    if not key:
        raise EmbeddingError("authentication_failed")
    try:
        async with asyncio.timeout(TIMEOUT):
            async with gate:
                async with AsyncOpenAI(api_key=key, base_url=BASE_URL, timeout=TIMEOUT, max_retries=0) as client:
                    vectors = []
                    for offset in range(0, len(flat), batch_size):
                        batch = flat[offset:offset + batch_size]
                        response = await client.embeddings.create(model=MODEL, input=batch, dimensions=DIMENSIONS)
                        if usage is not None:
                            info = getattr(response, "usage", None)
                            usage.append({"prompt_tokens": getattr(info, "prompt_tokens", None),
                                          "total_tokens": getattr(info, "total_tokens", None)})
                        data = sorted(response.data, key=lambda item: item.index)
                        if [item.index for item in data] != list(range(len(batch))):
                            raise EmbeddingError("invalid_vector")
                        vectors.extend(item.embedding for item in data)
        result = []
        offset = 0
        for group in groups:
            result.append(combine(vectors[offset:offset + len(group)], [len(text) for text in group]))
            offset += len(group)
        if any(len(vector) != len(result[0]) for vector in result):
            raise EmbeddingError("invalid_vector")
        return [max(-1.0, min(1.0, sum(a * b for a, b in zip(result[0], vector)))) for vector in result[1:]]
    except (TimeoutError, APITimeoutError):
        raise EmbeddingError("timeout") from None
    except APIStatusError as exc:
        body = exc.body if isinstance(exc.body, dict) else {}
        nested = body.get("error", body)
        code = str(nested.get("code", "")) if isinstance(nested, dict) else ""
        if code == "1113":
            raise EmbeddingError("insufficient_balance") from None
        if exc.status_code in (401, 403):
            raise EmbeddingError("authentication_failed") from None
        if exc.status_code == 429:
            raise EmbeddingError("rate_limited") from None
        raise EmbeddingError("unavailable") from None
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
