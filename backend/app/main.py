from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers.diagnose import router

app = FastAPI(title="简历-JD智能诊断系统")

# 允许前端跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/")
def read_root():
    return {"status": "ok"}