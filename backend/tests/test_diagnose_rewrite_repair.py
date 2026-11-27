import importlib
import json
import unittest
import os
from unittest.mock import AsyncMock, patch

from test_diagnose import PAYLOAD, valid_data
from test_diagnose import completion

module = importlib.import_module('app.routers.diagnose')


class RewriteRepairTests(unittest.TestCase):
    def test_presentation_repair_still_checks_every_source_quote(self):
        data = valid_data()
        data['gaps'][0].pop('severity')
        data['gaps'][0]['rewrite_suggestion'] = ''
        report = module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, repair_presentation=True)
        self.assertEqual(report.gaps[0].severity, 'medium')
        data['gaps'][0]['resume_evidence'] = '不存在的虚构经历'
        with self.assertRaises(ValueError):
            module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, repair_presentation=True)
    def test_repair_of_missing_placeholder_keeps_verified_analysis(self):
        data = valid_data()
        data['gaps'][0]['resume_evidence'] = None
        data['gaps'][0]['rewrite_suggestion'] = '建议积累相关实践并说明成果'
        with self.assertRaisesRegex(ValueError, 'rewrite_suggestion_placeholder_missing'):
            module.parse_report(json.dumps(data), PAYLOAD, 'id', 0)
        report = module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, lenient=True)
        self.assertEqual(report.gaps[0].jd_requirement, data['gaps'][0]['jd_requirement'])
        self.assertEqual(report.overall_score, 65)
        self.assertTrue(report.gaps[0].rewrite_suggestion.startswith('仅在确有相关经历时补充'))
        self.assertIn('【真实项目】', report.gaps[0].rewrite_suggestion)

    def test_repair_does_not_accept_fabricated_quotations_or_invalid_scores(self):
        data = valid_data()
        data['gaps'][0]['rewrite_suggestion'] = ''
        report = module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, lenient=True)
        self.assertIn('请勿编造经历', report.gaps[0].rewrite_suggestion)
        data['gaps'][0]['resume_evidence'] = '简历中不存在的经验'
        report = module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, lenient=True)
        self.assertEqual(report.gaps, [])
        data['dimension_scores'][0]['score'] = 101
        with self.assertRaises(ValueError):
            module.parse_report(json.dumps(data), PAYLOAD, 'id', 0, lenient=True)


class PresentationRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_valid_model_analysis_with_bad_rewrite_does_not_need_regeneration(self):
        data = valid_data()
        data['gaps'][0]['rewrite_suggestion'] = '补充真实项目相关经历'
        data['gaps'][0]['resume_evidence'] = None
        data['gaps'][0].pop('severity')
        with patch.dict(os.environ, {'MOCK_MODE': 'false', 'LLM_API_KEY': 'test-key'}), patch.object(module, 'AsyncOpenAI') as factory:
            create = factory.return_value.__aenter__.return_value.chat.completions.create = AsyncMock(return_value=completion(json.dumps(data)))
            report = await module.diagnose(PAYLOAD)
        self.assertEqual(create.await_count, 1)
        self.assertEqual(report.meta.mode, 'llm')
        self.assertEqual(report.overall_score, 65)
        self.assertIn('【真实项目】', report.gaps[0].rewrite_suggestion)
