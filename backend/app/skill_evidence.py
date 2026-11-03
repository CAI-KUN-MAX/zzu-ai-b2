"""Conservative, traceable skill observations; these do not affect ranking."""
import re

from app.schemas import Gap, Highlight


# Limited vocabulary prevents arbitrary English words in a JD becoming skills.
# Extend only with explicit spellings; lack of coverage is not evidence of absence.
SKILLS = {
    "Java": ("Java",), "JavaScript": ("JavaScript",), "TypeScript": ("TypeScript",),
    "Python": ("Python",), "Go": ("Go", "Golang"), "C++": ("C++",), "C#": ("C#",),
    "Spring Boot": ("Spring Boot", "SpringBoot"),
    "MyBatis": ("MyBatis",), "MySQL": ("MySQL",), "Redis": ("Redis",),
    "RabbitMQ": ("RabbitMQ",), "Docker": ("Docker",), "Kubernetes": ("Kubernetes",),
    "React": ("React",), "Vue": ("Vue",), "FastAPI": ("FastAPI",),
    "PostgreSQL": ("PostgreSQL",), "SQL": ("SQL",), "Git": ("Git",),
    "Linux": ("Linux",), "Spark": ("Spark",), "Excel": ("Excel",),
    "Pandas": ("Pandas",), "PyTorch": ("PyTorch",), "TensorFlow": ("TensorFlow",),
    "PCR": ("PCR", "聚合酶链式反应"), "用户访谈": ("用户访谈", "user interview"),
    "有限元分析": ("有限元分析", "finite element analysis"),
}
SENTENCE = re.compile(r"[^\n。；;！？!?]+")
SECTION_END = re.compile(r"^\s*(?:专业技能|技能清单|教育经历|自我评价|获奖经历|个人信息)\s*[:：]?\s*$")
PROJECT_SECTION = re.compile(r"^\s*(?:项目经历|实习经历|工作经历|项目经验|实习经验)\s*[:：]?\s*$")
PRACTICE = re.compile(r"使用|采用|运用|基于|利用|负责|参与|搭建|开发|设计|实现|部署|优化|构建|完成|used|built|developed|implemented|deployed", re.I)
TASK = re.compile(r"项目|系统|服务|平台|接口|功能|模块|数据|数据库|应用|实验|测试|分析|报告|流程|project|service|application|system|feature|data|test", re.I)
NEGATION = re.compile(r"没有|缺乏|缺少|不会|未使用|未接触|未掌握|不熟悉|不掌握|无相关|无经验|尚未|不了解|没有实践|无实践|not\s+(?:used|experienced|familiar)|no\s+experience", re.I)
WEAK = re.compile(r"了解|学习|接触|入门|听说|理论|计划|将要|拟使用|学习中|待学习|无实践|缺少实践|缺乏实践|未实践|未使用|未接触", re.I)


def mentions(text, name):
    return any(re.search(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", text, re.I)
               for alias in SKILLS[name])


def is_practical(part, project, name):
    if (project and re.search(r"技术栈|技术选型|tech stack", part, re.I)
            and not WEAK.search(part) and not NEGATION.search(part)):
        return True
    # Do not attribute an action on one skill to an unrelated skill elsewhere
    # in the same sentence. A comma separates independent descriptions here.
    for fragment in re.split(r"[,，]", part):
        if (not mentions(fragment, name) or not TASK.search(fragment)
                or WEAK.search(fragment) or NEGATION.search(fragment)):
            continue
        for alias in SKILLS[name]:
            token = rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])"
            if (re.search(rf"(?:{PRACTICE.pattern})[^,，]{{0,45}}{token}", fragment, re.I) or
                    re.search(rf"{token}[^,，]{{0,20}}(?:{PRACTICE.pattern})", fragment, re.I)):
                return True
    return False


def observations(resume, jd):
    """Collect every matching source sentence; ambiguous statements stay uncertain."""
    jd_parts = [m.group().strip() for m in SENTENCE.finditer(jd) if m.group().strip()]
    parts = []
    in_project = False
    for line in resume.splitlines():
        if PROJECT_SECTION.match(line):
            in_project = True
        elif SECTION_END.match(line):
            in_project = False
        for match in SENTENCE.finditer(line):
            part = match.group().strip()
            if part:
                parts.append((part, in_project))
    result = []
    for name in SKILLS:
        requirements = []
        for part in jd_parts:
            # Do not turn optional and alternative qualifications into mandatory gaps.
            if re.search(r"(?:或|任一|二选一|\bor\b)", part, re.I):
                continue
            for alias in SKILLS[name]:
                pattern = rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])"
                for match in re.finditer(pattern, part, re.I):
                    prefix = part[max(0, match.start() - 12):match.start()]
                    suffix = part[match.end():match.end() + 10]
                    if (not re.search(r"(?:不要求|不需要|无需|无须)[^,，、]{0,8}$", prefix)
                            and not re.match(r"\s*(?:为|是)?\s*(?:加分|优先|非必需|非必须)", suffix)):
                        requirements.append(part)
                        break
                if requirements and requirements[-1] == part:
                    break
        if not requirements:
            continue
        hits = [(part, project) for part, project in parts if mentions(part, name)]
        snippets = list(dict.fromkeys(part for part, _ in hits))
        negative = any(NEGATION.search(fragment) for part, _ in hits
                       for fragment in re.split(r"[,，]", part) if mentions(fragment, name))
        practical = [part for part, project in hits if is_practical(part, project, name)]
        status = ("not_found" if not hits else "uncertain" if negative else
                  "demonstrated" if practical else "mentioned_only")
        conclusions = {
            "demonstrated": f"简历体现 {name} 的实践描述。",
            "mentioned_only": f"简历提及 {name}，但缺少具体实践证据。",
            "not_found": f"简历中未体现 {name} 相关经验。",
            "uncertain": f"简历中 {name} 的使用情况存在否定或不明确描述，需进一步确认。",
        }
        result.append(dict(skill_name=name, requirement=True, jd_evidence=requirements[0],
                           resume_evidence=snippets, evidence_status=status,
                           demonstrated_evidence=practical[0] if status == "demonstrated" else None,
                           assessment=conclusions[status]))
    return result


def reconcile_job_report(report, skills):
    """Regenerate skill-specific cards from source observations, keeping other cards."""
    report = report.model_copy(deep=True)
    def refers(text):
        return any(mentions(text, skill["skill_name"]) for skill in skills)

    report.highlights = [h for h in report.highlights if not refers(h.title)]
    # A JD quotation can contain several unrelated requirements. Keep an
    # education or experience gap merely quoting such a sentence unless its
    # actual judgment or advice refers to a recognized skill.
    report.gaps = [g for g in report.gaps if not refers(g.title)]
    for skill in skills:
        name, status = skill["skill_name"], skill["evidence_status"]
        if status == "demonstrated":
            # Choose a practical sentence, not an earlier bare mention.
            report.highlights.append(Highlight(title=skill["assessment"], evidence=skill["demonstrated_evidence"], source="resume"))
        else:
            suggestion = (f"核对 {name} 的实际经历；仅在确有相关实践时补充具体任务和成果。")
            report.gaps.append(Gap(title=skill["assessment"], jd_requirement=skill["jd_evidence"],
                                   resume_evidence=skill["resume_evidence"][0] if skill["resume_evidence"] else None,
                                   suggestion=suggestion,
                                   rewrite_suggestion=f"仅在确有相关经历时补充：使用 {name} 完成【真实任务】，取得【真实成果】。",
                                   severity="medium"))
    if skills:
        report.summary = f"依据简历原文与岗位要求分析，综合匹配度为 {report.overall_score} 分；技能证据请结合原文核对。"
    return report


class InconsistentSkillReport(ValueError):
    """A remaining model statement conflicts with recognized source evidence."""


def validate_job_report(report, skills):
    """Fail closed when a remaining gap directly denies a demonstrated skill."""
    denial = re.compile(r"缺乏|缺少|欠缺|缺失|未体现|未掌握|不会|没有|无经验|不具备|不足|lack|missing|no experience", re.I)
    for skill in skills:
        if skill["evidence_status"] != "demonstrated":
            continue
        for gap in report.gaps:
            # JD and resume quotations are evidence, not the model's judgment.
            for text in (gap.title, gap.suggestion, gap.rewrite_suggestion):
                if any(mentions(fragment, skill["skill_name"]) and denial.search(fragment)
                       for fragment in re.split(r"[，,。；;\n]", text)):
                    raise InconsistentSkillReport()
