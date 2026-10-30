from app.schemas import DiagnoseResponse, DimensionScore, Highlight, Gap, MetaInfo

MOCK_RESPONSES = {
    "high": DiagnoseResponse(
        request_id="", overall_score=85, level="high", level_label="强匹配",
        dimension_scores=[
            DimensionScore(key="skill_match", label="技能匹配", score=90, weight=0.4),
            DimensionScore(key="experience_relevance", label="经历相关", score=85, weight=0.3),
            DimensionScore(key="keyword_coverage", label="关键词覆盖", score=80, weight=0.2),
            DimensionScore(key="education_match", label="教育/证书", score=85, weight=0.1)
        ],
        highlights=[
            Highlight(title="技能栈高度契合", evidence="熟练掌握Python、FastAPI和Redis", source="resume")
        ],
        gaps=[
            Gap(title="缺乏K8s经验", jd_requirement="熟悉Kubernetes容器编排", resume_evidence="了解Docker部署", suggestion="建议补充K8s相关项目经验", rewrite_suggestion="了解 Docker 部署，并在【真实项目】中完成 Kubernetes 基础编排与发布验证。", severity="low")
        ],
        summary="候选人背景与岗位高度匹配，建议进入面试。",
        meta=MetaInfo(mode="mock", elapsed_ms=120)
    ),
    "medium": DiagnoseResponse(
        request_id="", overall_score=65, level="medium", level_label="较匹配",
        dimension_scores=[
            DimensionScore(key="skill_match", label="技能匹配", score=70, weight=0.4),
            DimensionScore(key="experience_relevance", label="经历相关", score=60, weight=0.3),
            DimensionScore(key="keyword_coverage", label="关键词覆盖", score=65, weight=0.2),
            DimensionScore(key="education_match", label="教育/证书", score=65, weight=0.1)
        ],
        highlights=[
            Highlight(title="有后端开发基础", evidence="熟悉Python和MySQL", source="resume")
        ],
        gaps=[
            Gap(title="缺乏高并发经验", jd_requirement="有高并发微服务架构经验", resume_evidence=None, suggestion="建议在简历中突出性能优化经历", rewrite_suggestion="仅在确有相关经历时补充：针对【真实系统】完成【压测/性能优化】，将【真实指标】从【优化前】提升至【优化后】。", severity="medium")
        ],
        summary="具备一定基础，但高级工程化经验略显不足。",
        meta=MetaInfo(mode="mock", elapsed_ms=110)
    ),
    "low": DiagnoseResponse(
        request_id="", overall_score=45, level="low", level_label="存在缺口",
        dimension_scores=[
            DimensionScore(key="skill_match", label="技能匹配", score=40, weight=0.4),
            DimensionScore(key="experience_relevance", label="经历相关", score=45, weight=0.3),
            DimensionScore(key="keyword_coverage", label="关键词覆盖", score=50, weight=0.2),
            DimensionScore(key="education_match", label="教育/证书", score=50, weight=0.1)
        ],
        highlights=[],
        gaps=[
            Gap(title="缺乏Web框架实战", jd_requirement="熟练使用FastAPI/Django", resume_evidence="仅使用Python写脚本", suggestion="建议学习并独立完成一个Web后端项目", rewrite_suggestion="使用 Python 编写【真实脚本用途】；在完成【真实 Web 项目】后，可补充所用框架、接口范围与验证结果。", severity="high"),
            Gap(title="数据库设计缺失", jd_requirement="熟悉关系型数据库设计", resume_evidence=None, suggestion="补充数据库建模和SQL优化经验", rewrite_suggestion="仅在确有相关经历时补充：为【真实项目】设计【真实数据表/关系】，并通过【真实方法】优化查询性能。", severity="high")
        ],
        summary="当前背景与岗位要求存在较大差距。",
        meta=MetaInfo(mode="mock", elapsed_ms=130)
    )
}
