import unittest

from app.mock_data import MOCK_RESPONSES
from app.schemas import Gap, Highlight
from app.skill_evidence import InconsistentSkillReport, observations, reconcile_job_report, validate_job_report


class SkillEvidenceTests(unittest.TestCase):
    def test_ux_practice_mentions_and_negation_are_distinct(self):
        resume = ("项目经历\n开展用户访谈与可用性测试。\n"
                  "使用 Figma 设计交互原型。\n技能：Axure。\n未使用用户研究。")
        jd = "要求用户访谈、可用性测试、Figma、Axure 和用户研究。"
        skills = {item["skill_name"]: item for item in observations(resume, jd)}
        self.assertEqual(skills["用户访谈"]["evidence_status"], "demonstrated")
        self.assertEqual(skills["可用性测试"]["evidence_status"], "demonstrated")
        self.assertEqual(skills["Figma"]["evidence_status"], "demonstrated")
        self.assertEqual(skills["Axure"]["evidence_status"], "mentioned_only")
        self.assertEqual(skills["用户研究"]["evidence_status"], "uncertain")
        for skill in skills.values():
            self.assertIn(skill["jd_evidence"], jd)
            self.assertTrue(all(quote in resume for quote in skill["resume_evidence"]))

    def test_shared_resume_and_jd_with_multiple_sources(self):
        resume = ("技能：Java、MySQL、Spring Boot\n项目经历\n"
                  "订单项目：使用 Java 开发订单服务。\n"
                  "订单项目技术栈：Spring Boot、Redis。\n"
                  "另一个项目：使用 Java 实现支付接口。")
        jd = "岗位要求：熟悉 Java、Spring Boot、MySQL、Docker 和 Redis。"
        skills = observations(resume, jd)
        by_name = {item["skill_name"]: item for item in skills}
        self.assertEqual(by_name["Java"]["evidence_status"], "demonstrated")
        self.assertEqual(by_name["Spring Boot"]["evidence_status"], "demonstrated")
        self.assertEqual(by_name["MySQL"]["evidence_status"], "mentioned_only")
        self.assertEqual(by_name["Docker"]["evidence_status"], "not_found")
        self.assertEqual(by_name["Redis"]["evidence_status"], "demonstrated")
        self.assertEqual(len(by_name["Java"]["resume_evidence"]), 3)
        self.assertNotIn("RabbitMQ", by_name)
        for item in skills:
            self.assertIn(item["jd_evidence"], jd)
            self.assertTrue(all(evidence in resume for evidence in item["resume_evidence"]))

        report = MOCK_RESPONSES["medium"].model_copy(deep=True)
        original_score = report.overall_score
        report.highlights = [Highlight(title="Java项目", evidence="订单项目：使用 Java 开发订单服务", source="resume")]
        report.gaps = [Gap(title="缺乏 Java 和 Docker", jd_requirement=jd, resume_evidence=None,
                           suggestion="补充经验", rewrite_suggestion="仅在确有相关经历时补充【真实任务】", severity="high")]
        reconciled = reconcile_job_report(report, skills)
        self.assertEqual(reconciled.overall_score, original_score)
        self.assertTrue(any("Java" in h.title for h in reconciled.highlights))
        self.assertFalse(any("Java" in g.title for g in reconciled.gaps))
        self.assertTrue(any("未体现 Docker" in g.title for g in reconciled.gaps))
        self.assertTrue(any("MySQL" in g.title and "缺少具体实践" in g.title for g in reconciled.gaps))
        self.assertEqual(report.gaps[0].title, "缺乏 Java 和 Docker")

    def test_other_skills_boundaries_and_negation(self):
        resume = "项目经历\n使用 Python 开发数据分析系统。\n技能：React、JavaScript\n未使用 Docker。"
        jd = "岗位要求 Python、React、Java、Docker 和 PCR。"
        by_name = {item["skill_name"]: item for item in observations(resume, jd)}
        self.assertEqual(by_name["Python"]["evidence_status"], "demonstrated")
        self.assertEqual(by_name["React"]["evidence_status"], "mentioned_only")
        self.assertEqual(by_name["Java"]["evidence_status"], "not_found")
        self.assertEqual(by_name["Docker"]["evidence_status"], "uncertain")
        self.assertEqual(by_name["PCR"]["evidence_status"], "not_found")

    def test_action_does_not_apply_to_unrelated_mention(self):
        resume = "技能：MySQL，使用 Java 开发订单服务。"
        by_name = {item["skill_name"]: item for item in observations(resume, "需要 Java 和 MySQL")}
        self.assertEqual(by_name["Java"]["evidence_status"], "demonstrated")
        self.assertEqual(by_name["MySQL"]["evidence_status"], "mentioned_only")

    def test_negation_of_another_skill_and_optional_requirements(self):
        resume = "项目经历\n使用 Java 开发订单系统，但没有 Docker 经验。"
        by_name = {item["skill_name"]: item for item in observations(resume, "要求 Java 和 Docker")}
        self.assertEqual(by_name["Java"]["evidence_status"], "demonstrated")
        self.assertEqual(by_name["Docker"]["evidence_status"], "uncertain")
        self.assertEqual(observations(resume, "不要求 Docker"), [])
        self.assertEqual(observations(resume, "Docker 为加分项"), [])
        self.assertEqual(observations(resume, "Java 或 Python 均可"), [])

    def test_preserves_non_skill_feedback_quoting_skill(self):
        resume = "项目经历\n使用 Java 开发订单系统并参与团队协作。"
        skills = observations(resume, "要求 Java 及沟通能力")
        report = MOCK_RESPONSES["medium"].model_copy(deep=True)
        report.highlights = [Highlight(title="团队协作", evidence="使用 Java 开发订单系统并参与团队协作", source="resume")]
        report.gaps = [Gap(title="沟通经历有待补充", jd_requirement="要求 Java 及沟通能力", resume_evidence=None,
                           suggestion="结合 Java 项目说明协作", rewrite_suggestion="【真实经历】", severity="medium")]
        result = reconcile_job_report(report, skills)
        self.assertTrue(any(item.title == "团队协作" for item in result.highlights))
        self.assertTrue(any(item.title == "沟通经历有待补充" for item in result.gaps))
        validate_job_report(result, skills)
        result.gaps[0].suggestion = "缺乏 Java 经验，应补充相关内容"
        with self.assertRaises(InconsistentSkillReport):
            validate_job_report(result, skills)


if __name__ == "__main__":
    unittest.main()
