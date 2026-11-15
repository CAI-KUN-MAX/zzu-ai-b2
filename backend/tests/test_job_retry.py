import json
import unittest
from unittest.mock import patch

from app.main import app
from app.mock_data import MOCK_RESPONSES
from fixture_client import CsrfClient
import test_job_matching as fixtures


class JobRetryTests(unittest.TestCase):
    setUp = fixtures.JobMatchingTests.setUp
    tearDown = fixtures.JobMatchingTests.tearDown
    create = fixtures.JobMatchingTests.create
    wait = fixtures.JobMatchingTests.wait

    def test_retry_preserves_scores_snapshot_and_other_items(self):
        parent = self.create()
        original = self.wait(parent)
        item = next(i for i in original['items'] if i['job_id'] == 'a')
        with app.state.store.connect() as db:
            rows = json.loads(app.state.job_repository.task(parent)['result'])
            for row in rows:
                if row['job_id'] == 'a':
                    row['stage1_score'] = 71
                    row['embedding_similarity'] = .82
            app.state.job_repository.update(parent, result=rows)
        with patch.object(app.state.match_jobs, 'report_for', return_value=MOCK_RESPONSES['medium']) as model:
            response = self.client.post(f'/api/job-matches/{parent}/items/a/retry')
            self.assertEqual(response.status_code, 202, response.text)
            retry_id = response.json()['task_id']
            result = self.wait(retry_id)
        self.assertNotEqual(retry_id, parent)
        self.assertEqual(len(result['items']), 1)
        retried = result['items'][0]
        self.assertEqual(retried['stage1_score'], 71)
        self.assertEqual(retried['embedding_similarity'], .82)
        self.assertIsNotNone(retried['analysis_started_at'])
        self.assertIsNotNone(retried['analysis_finished_at'])
        self.assertGreaterEqual(retried['analysis_elapsed_ms'], 0)
        self.assertTrue(model.call_args.kwargs['fresh'])
        refreshed = self.wait(parent)
        self.assertEqual(next(i for i in refreshed['items'] if i['job_id'] == 'a')['stage1_score'], 71)
        self.assertEqual([i for i in original['items'] if i['job_id'] != 'a'],
                         [i for i in refreshed['items'] if i['job_id'] != 'a'])

    def test_retry_rejects_another_guest_and_unknown_job(self):
        parent = self.create()
        self.wait(parent)
        with CsrfClient(app) as stranger:
            response = stranger.post(f'/api/job-matches/{parent}/items/a/retry')
            self.assertEqual(response.status_code, 404)
        self.assertEqual(self.client.post(f'/api/job-matches/{parent}/items/nope/retry').status_code, 404)

    def test_retry_calls_model_even_when_a_report_is_cached(self):
        report = MOCK_RESPONSES['medium'].model_copy(deep=True)
        report.meta.mode = 'llm'
        with patch.dict('os.environ', {'MATCH_LLM_TOP_K': '1'}), patch('app.matching.run_diagnose', return_value=report) as model:
            parent = self.create(['a'])
            self.wait(parent)
            response = self.client.post(f'/api/job-matches/{parent}/items/a/retry')
            self.assertEqual(response.status_code, 202)
            self.wait(response.json()['task_id'])
            self.assertEqual(model.call_count, 2)

    def test_failed_task_finishes_running_items(self):
        from app.job_matching import finish_unresolved
        items = [{'analysis_status': 'running', 'analysis_started_at': '2026-11-14T00:00:00+00:00'}]
        finish_unresolved(items, 'unknown')
        self.assertEqual(items[0]['analysis_status'], 'degraded')
        self.assertEqual(items[0]['analysis_error'], 'unknown')
        self.assertGreaterEqual(items[0]['analysis_elapsed_ms'], 0)
