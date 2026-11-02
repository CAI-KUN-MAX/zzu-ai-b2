from fastapi import APIRouter, Query, Request

from app.job_schemas import (ApplicationStatus, Category, Education, Job, JobList,
                             JobMatchRequest, JobMatchTask, MatchContext, TaskCreated)
from app.routers.resumes import fail
from app.schemas import ErrorResponse

router = APIRouter(responses={status: {"model": ErrorResponse} for status in (400, 404, 409, 422)})


@router.get("/api/jobs", response_model=JobList)
async def list_jobs(request: Request, category: Category | None = None, education: Education | None = None,
                    application_status: ApplicationStatus | None = None, page: int = Query(1, ge=1),
                    page_size: int = Query(20, ge=1, le=100)):
    return request.app.state.job_repository.list(category, education, application_status, page, page_size)


@router.get("/api/jobs/testing-pool", response_model=JobList)
async def testing_pool(request: Request, category: Category | None = None, education: Education | None = None,
                       page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100)):
    return request.app.state.job_repository.testing_pool(category, education, page, page_size)


@router.get("/api/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str, request: Request):
    job = request.app.state.job_repository.jobs.get(job_id)
    if job is None:
        fail(404, "JOB_NOT_FOUND", "岗位不存在")
    return job


@router.post("/api/job-matches", status_code=202, response_model=TaskCreated)
async def create_job_match(payload: JobMatchRequest, request: Request):
    return request.app.state.job_matches.create(payload)


@router.get("/api/job-matches/{task_id}", response_model=JobMatchTask, response_model_exclude_unset=True)
async def get_job_match(task_id: str, request: Request):
    return request.app.state.job_matches.result(task_id)


@router.get("/api/job-matches/{task_id}/items/{job_id}/context", response_model=MatchContext)
async def get_context(task_id: str, job_id: str, request: Request):
    return request.app.state.job_matches.context(task_id, job_id)
