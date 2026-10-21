import asyncio
import importlib
import json
import os
import unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.main import app
from app.mock_data import MOCK_RESPONSES
from app.schemas import DiagnoseRequest

module = importlib.import_module("app.routers.diagnose")
PAYLOAD = DiagnoseRequest(resume_text="熟悉Python和MySQL", jd_text="要求Python和MySQL，熟悉Kubernetes容器编排")


def valid_data(score=65):
    data = MOCK_RESPONSES["medium"].model_dump()
    for dimension in data["dimension_scores"]:
        dimension["score"] = score
    data["gaps"][0]["jd_requirement"] = "熟悉Kubernetes容器编排"
    return data


def completion(content, reason="stop"):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason=reason, message=SimpleNamespace(content=content))])


class ParseTests(unittest.TestCase):
    def test_three_levels_and_server_fields(self):
        for score, level in ((90, "high"), (65, "medium"), (30, "low")):
            data = valid_data(score)
            data.update(request_id="injected", disclaimer="injected", overall_score=100)
            report = module.parse_report(json.dumps(data), PAYLOAD, "server-id", 25)
            self.assertEqual((report.overall_score, report.level), (score, level))
            self.assertEqual(report.request_id, "server-id")
            self.assertNotEqual(report.disclaimer, "injected")
            self.assertEqual(report.meta.mode, "llm")

    def test_code_fence(self):
        report = module.parse_report("```json\n" + json.dumps(valid_data()) + "\n```", PAYLOAD, "id", 0)
        self.assertEqual(report.overall_score, 65)

    def test_invalid_json(self):
        for content in (None, "", "[]", "null", "{bad", "prefix {}"):
            with self.subTest(content=content), self.assertRaises((ValueError, KeyError, TypeError)):
                module.parse_report(content, PAYLOAD, "id", 0)

    def test_invalid_business_fields(self):
        mutations = [
            lambda d: d.update(dimension_scores=[]),
            lambda d: d["dimension_scores"][0].update(weight=-1),
            lambda d: d["dimension_scores"][0].update(score=101),
            lambda d: d["highlights"][0].update(evidence="虚构证据"),
            lambda d: d["gaps"][0].update(severity="urgent"),
            lambda d: d["gaps"][0].update(jd_requirement="虚构要求"),
            lambda d: d["gaps"][0].update(resume_evidence="虚构经历"),
            lambda d: d.update(summary=" "),
        ]
        for mutate in mutations:
            data = deepcopy(valid_data())
            mutate(data)
            with self.assertRaises((ValueError, KeyError, TypeError)):
                module.parse_report(json.dumps(data), PAYLOAD, "id", 0)


class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env = patch.dict(os.environ, {"MOCK_MODE": "false", "LLM_API_KEY": "test-key"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.factory = patch.object(module, "AsyncOpenAI")
        self.client_class = self.factory.start()
        self.addCleanup(self.factory.stop)
        self.client = self.client_class.return_value.__aenter__.return_value
        self.create = self.client.chat.completions.create = AsyncMock()

    async def test_retry_and_success(self):
        self.create.side_effect = [completion("bad"), completion(json.dumps(valid_data()))]
        report = await module.diagnose(PAYLOAD)
        self.assertEqual(report.overall_score, 65)
        self.assertEqual(self.create.await_count, 2)
        self.assertEqual(self.client_class.call_args.kwargs["max_retries"], 0)

    async def test_truncation_retry(self):
        self.create.side_effect = [completion("{}", "length"), completion(json.dumps(valid_data()))]
        await module.diagnose(PAYLOAD)
        self.assertEqual(self.create.await_count, 2)

    async def test_exhausted_retry(self):
        self.create.return_value = completion(None)
        with self.assertRaises(module.HTTPException) as caught:
            await module.diagnose(PAYLOAD)
        self.assertEqual(caught.exception.status_code, 500)
        self.assertEqual(self.create.await_count, 2)

    async def test_upstream_error_no_leak_or_retry(self):
        self.create.side_effect = RuntimeError("SECRET_RESUME_TEXT")
        with self.assertLogs(module.logger, level="WARNING") as logs:
            with self.assertRaises(module.HTTPException) as caught:
                await module.diagnose(PAYLOAD)
        self.assertNotIn("SECRET_RESUME_TEXT", str(caught.exception.detail) + str(logs.output))
        self.assertEqual(self.create.await_count, 1)

    async def test_total_timeout(self):
        async def slow_call(**kwargs):
            await asyncio.sleep(1)
        self.create.side_effect = slow_call
        with patch.object(module, "TOTAL_TIMEOUT", 0.01):
            with self.assertRaises(module.HTTPException) as caught:
                await module.diagnose(PAYLOAD)
        self.assertEqual(caught.exception.status_code, 504)

    async def test_mock_without_model(self):
        with patch.dict(os.environ, {"MOCK_MODE": "true"}):
            report = await module.diagnose(PAYLOAD)
        self.assertEqual(report.meta.mode, "mock")
        self.client_class.assert_not_called()

    async def test_http_contract(self):
        try:
            import httpx
        except ImportError:
            import httpx2 as httpx
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            missing = await client.post("/api/diagnose", json={})
            self.assertEqual(missing.status_code, 422)
            self.assertEqual(missing.json()["error"]["code"], "VALIDATION_ERROR")
            blank = await client.post("/api/diagnose", json={"resume_text": " ", "jd_text": "test"})
            self.assertEqual(blank.status_code, 400)
            self.assertEqual(blank.json()["error"]["code"], "INVALID_INPUT")
            self.create.side_effect = TimeoutError()
            timeout = await client.post("/api/diagnose", json=PAYLOAD.model_dump())
            self.assertEqual(timeout.status_code, 504)
            self.assertEqual(timeout.json()["error"]["code"], "LLM_TIMEOUT")
            with patch.dict(os.environ, {"MOCK_MODE": "true"}):
                success = await client.post("/api/diagnose", json=PAYLOAD.model_dump())
            self.assertEqual(success.status_code, 200)
            schema = (await client.get("/openapi.json")).json()
            self.assertIn("504", schema["paths"]["/api/diagnose"]["post"]["responses"])


if __name__ == "__main__":
    unittest.main()
