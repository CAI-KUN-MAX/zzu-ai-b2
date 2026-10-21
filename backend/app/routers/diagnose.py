import os
import json
import uuid
import time
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from openai import OpenAI
from app.schemas import DiagnoseRequest, DiagnoseResponse, MetaInfo
from app.mock_data import MOCK_RESPONSES

# 强制加载当前目录（backend）下的 .env 文件
load_dotenv() # <--- 新增这行

router = APIRouter()

# 极简 Prompt 模板
SYSTEM_PROMPT = """
你是一个资深的HR专家。请根据提供的【简历】和【岗位JD】进行诊断。
你必须严格输出纯 JSON 格式，不要输出任何 Markdown 标记（如 ```json），不要输出任何解释文字。
JSON 必须严格包含以下字段结构：
{
    "overall_score": 匹配分数（整数，0-100）,
    "level": "high" 或 "medium" 或 "low",
    "level_label": "强匹配" 或 "较匹配" 或 "存在缺口",
    "dimension_scores": [
        {"key": "skill_match", "label": "技能匹配", "score": 整数, "weight": 0.4},
        {"key": "experience_relevance", "label": "经历相关", "score": 整数, "weight": 0.3},
        {"key": "keyword_coverage", "label": "关键词覆盖", "score": 整数, "weight": 0.2},
        {"key": "education_match", "label": "教育/证书", "score": 整数, "weight": 0.1}
    ],
    "highlights": [{"title": "亮点标题", "evidence": "证据原文", "source": "resume"}],
    "gaps": [{"title": "缺口标题", "jd_requirement": "JD要求原文", "resume_evidence": "简历证据(如果没有填null)", "suggestion": "改进建议", "severity": "high或medium或low"}],
    "summary": "一句话总体评价",
    "disclaimer": "AI诊断结果仅供参考，请以实际岗位要求为准。"
    【强制约束，必须遵守】
    1. 即使候选人与岗位完全不匹配，overall_score 最低也给 1 分，不能全 0。
    2. highlights 数组绝不能为空，哪怕提取“学习意愿”等微弱优势，也必须输出至少 1 条。
    3. gaps 数组必须包含至少 2 条记录，详细指出缺失的技能或经验。
    4. 如果候选人匹配度极高（如90分以上），gaps 数组也不能为空！必须从“精益求精”的角度，给出至少 1 条优化建议（例如：补充更多量化数据、突出团队管理经验等），severity 设为 low。
}
"""

@router.post("/api/diagnose", response_model=DiagnoseResponse)
def diagnose(payload: DiagnoseRequest):
    if not payload.resume_text.strip() or not payload.jd_text.strip():
        raise HTTPException(status_code=400, detail="简历或JD文本不能为空")
    
    request_id = uuid.uuid4().hex

    # 增加这行打印，在终端里看结果！
    print(f"====== 当前读取到的 MOCK_MODE 是: {os.getenv('MOCK_MODE')} ======")


    # 默认走 Mock，只有在 .env 里明确写了 false 才走大模型
    mock_mode = os.getenv("MOCK_MODE", "true").lower() == "true"

    if mock_mode:
        res = MOCK_RESPONSES["medium"].model_copy(deep=True)
        res.request_id = request_id
        return res
    
    # ================= 真实 LLM 逻辑 =================
    start_time = time.time()
    api_key = os.getenv("LLM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="服务器未配置 LLM_API_KEY")

    try:
        client = OpenAI(
            api_key=api_key,
            base_url="https://open.bigmodel.cn/api/paas/v4/",
            timeout=30.0
        )
        
        user_prompt = f"【简历】\n{payload.resume_text}\n\n【岗位JD】\n{payload.jd_text}"
        
        response = client.chat.completions.create(
            model="glm-4-flash",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        
        raw_json = response.choices[0].message.content
        data_dict = json.loads(raw_json)
        
        # 强制覆盖服务端字段
        data_dict["request_id"] = request_id
        data_dict["meta"] = {
            "model": "glm-4-flash", 
            "mode": "llm", 
            "elapsed_ms": int((time.time() - start_time) * 1000)
        }
        
        return DiagnoseResponse(**data_dict)
        
    except Exception as e:
        print(f"❌ 大模型调用失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI 诊断失败: {str(e)}")