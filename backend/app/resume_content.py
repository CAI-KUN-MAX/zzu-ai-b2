"""Conservative, deterministic resume-content classification after extraction."""
import re
from dataclasses import dataclass


CONTENT_MISMATCH = {"code": "CONTENT_MISMATCH", "message": "文件内容不像简历，请上传包含教育、经历和技能信息的个人简历"}
CONTENT_REVIEW_REQUIRED = {"code": "CONTENT_REVIEW_REQUIRED", "message": "简历特征不足或识别质量较低，请确认解析内容后再继续"}


@dataclass(frozen=True)
class Classification:
    status: str
    error: dict | None = None


FEATURES = {
    "identity": (r"(?:姓名|性别|出生年月|联系方式|联系电话|手机|邮箱|求职意向|个人信息)",
                 r"\b1[3-9]\d{9}\b", r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"),
    "education": (r"(?:教育经历|教育背景|学历|学位|本科|硕士|博士|大专|大学|学院|毕业院校|专业)",),
    "experience": (r"(?:工作经历|实习经历|项目经历|校园经历|实践经历|任职经历|工作经验|项目成果|负责|参与|主导|开发|设计|实施)",),
    "skills": (r"(?:专业技能|技能证书|技能|证书|英语[四六]级|CET-?[46]|计算机[二三四]级|熟悉|掌握|精通|Python|Java|C\+\+|SQL|Office)",),
}

NEGATIVE_FEATURES = {
    "notice": (r"(?:通知|通告|公告|课程安排|上课时间|请各位同学|特此通知|会议议程|放假安排)",),
    "contract": (r"(?:甲方|乙方|本合同|合同编号|违约责任|争议解决|签字盖章|协议条款)",),
    "paper": (r"(?:摘要|关键词|参考文献|研究方法|实验结果|论文|引言|致谢)",),
    "job": (r"(?:招聘岗位|岗位职责|任职要求|职位描述|薪资待遇|投递方式|招聘人数|我们正在招聘)",),
    "chat": (r"(?:微信聊天记录|聊天记录|撤回了一条消息|群聊|\d{1,2}:\d{2}\s*$)",),
    "article": (r"(?:记者|本报讯|文章来源|责任编辑|阅读原文|新闻报道)",),
}


def _hits(text, patterns):
    return sum(any(re.search(pattern, text, re.I | re.M) for pattern in group) for group in patterns.values())


def _matches(text, patterns):
    return {name for name, group in patterns.items()
            if any(re.search(pattern, text, re.I | re.M) for pattern in group)}


def classify_resume(text: str, *, low_conf: int = 0) -> Classification:
    """Classify conservatively: ambiguous or noisy content always needs review."""
    compact = text.strip()
    positives = _hits(compact, FEATURES)
    negative_types = _matches(compact, NEGATIVE_FEATURES)
    negatives = len(negative_types)

    # Strong document-type evidence takes precedence unless the text also has a
    # broad personal-resume structure. This blocks JDs, contracts and papers.
    if "job" in negative_types and not re.search(FEATURES["identity"][0], compact, re.I):
        return Classification("not_resume", CONTENT_MISMATCH)
    if (negatives >= 2 and positives <= 2) or (negatives >= 1 and positives == 0):
        return Classification("not_resume", CONTENT_MISMATCH)
    if len(compact) >= 120 and positives == 0:
        return Classification("not_resume", CONTENT_MISMATCH)

    # Two independent resume sections are enough for ordinary concise resumes;
    # OCR uncertainty and all borderline cases remain reviewable, not rejected.
    if low_conf or len(compact) < 30 or positives < 2 or negatives:
        return Classification("need_review", CONTENT_REVIEW_REQUIRED)
    return Classification("ready")
