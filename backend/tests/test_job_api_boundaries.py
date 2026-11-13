import hashlib
import unittest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.jobs import router
from app.job_repository import JobRepository
from app.job_schemas import Job

JD = '岗位职责：' + '负责软件开发和团队协作。' * 8 + '任职要求：' + '熟悉软件开发和数据分析。' * 8
PROOF = dict(source_url='https://example.com/proof', checked_at='2020-01-01T00:00:00Z', valid_until='2100-01-01T00:00:00Z', note='虚构证据')
def job(name, status='open', evidence=None, url='https://example.com/apply'):
    return Job.model_validate(dict(job_id=name, title='测试', company='虚构公司', cities=['北京'], category='计算机', education='本科', education_requirement='本科', majors=['计算机'], graduation_year='2027', jd_text=JD, source_url='https://example.com/source', published_at='2026-01-01', publication_type='original', application_url=url, verified_at='2026-01-01T00:00:00Z', application_status=status, verification_note='虚构', evidence=evidence))
def evidence(status='open', content='full', application='https://example.com/apply'):
    return dict(status={**PROOF,'status':status},content={**PROOF,'completeness':content,'jd_sha256':hashlib.sha256(JD.encode()).hexdigest()},application={**PROOF,'application_url':application})
class JobAPIBoundaries(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.include_router(router)
        repo = object.__new__(JobRepository)
        repo.evidence_path = None
        repo.version = 'synthetic'
        repo.jobs = {
          'verified':job('verified',evidence=evidence()),
          'legacy':job('legacy'),
          'mismatch':job('mismatch',evidence=evidence(application='https://example.com/other')),
          'closed':job('closed',evidence=evidence(status='closed')),
          'campaign':job('campaign',evidence=evidence(content='campaign')),
          'summary':job('summary',evidence=evidence(content='summary')),
          'expired':job('expired',evidence={**evidence(), 'status':{**PROOF,'valid_until':'2021-01-01T00:00:00Z','status':'open'}}),
        }
        app.state.job_repository = repo
        self.client = TestClient(app)
    def test_detail_fields_and_verified_entry_are_independent(self):
        for name,expected in {'verified':('open','full',True),'legacy':('unverified','unknown',False),'mismatch':('open','full',False),'closed':('closed','full',False),'campaign':('open','campaign',True),'summary':('open','summary',True),'expired':('unverified','full',False)}.items():
            with self.subTest(name=name):
                response=self.client.get('/api/jobs/'+name)
                self.assertEqual(response.status_code,200)
                body=response.json()
                self.assertEqual((body['effective_status'],body['jd_completeness'],body['application_verified']),expected)
    def test_default_list_excludes_closed_and_campaign_but_keeps_unverified(self):
        response=self.client.get('/api/jobs')
        self.assertEqual(response.status_code,200)
        names={j['job_id'] for j in response.json()['items']}
        self.assertEqual(names,{'verified','legacy','mismatch','summary','expired'})

if __name__ == '__main__': unittest.main()
