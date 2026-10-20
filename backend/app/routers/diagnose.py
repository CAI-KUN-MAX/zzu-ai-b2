import os
import uuid
from fastapi import APIRouter, HTTPException
from app.schemas import DiagnoseRequest, DiagnoseResponse
from app.mock_data import MOCK_RESPONSES

router = APIRouter()

@router.post("/api/diagnose", response_model=DiagnoseResponse)
def diagnose(payload: DiagnoseRequest):
    if not payload.resume_text.strip() or not payload.jd_text.strip():
        raise HTTPException(status_code=400, detail="简历或JD文本不能为空")
    
    request_id = uuid.uuid4().hex
    mock_mode = os.getenv("MOCK_MODE", "true").lower() == "true"

    if mock_mode:
        # 根据简历字数简单轮询返回三种结果，方便前端测试不同UI
        length = len(payload.resume_text)
        if length % 3 == 0:
            res = MOCK_RESPONSES["low"].model_copy(deep=True)
        elif length % 3 == 1:
            res = MOCK_RESPONSES["high"].model_copy(deep=True)
        else:
            res = MOCK_RESPONSES["medium"].model_copy(deep=True)
        
        res.request_id = request_id
        return res
    else:
        raise HTTPException(status_code=501, detail="LLM 尚未接入")