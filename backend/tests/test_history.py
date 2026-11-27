import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch
from app.main import app
from app.history_repository import HistoryRepository
from app.history_service import HistoryService
from fixture_client import CsrfClient
import test_job_matching as fixtures


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {'DATA_DIR': self.directory.name, 'ENABLE_DOCS': 'false'})
        self.environment.start()
        self.context = CsrfClient(app)
        self.client = self.context.__enter__()
        self.client.get('/api/history')

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.environment.stop()
        self.directory.cleanup()

    def guest_owner(self, client):
        client.get('/api/history')
        return 'guest:' + client.cookies.get('resume_guest')

    def seed(self, owner, prefix):
        resume, ingest, match, interview = [prefix + x for x in ('r', 't', 'm', 'i')]
        date = '2020-01-01T00:00:00+00:00'
        job = fixtures.fixture_job(prefix + 'job')
        snapshot = dict(owner=owner, resume_id=resume, resume_text='PRIVATE_RESUME', jobs=[job], recommendation=False)
        state = dict(status='completed', round=5, question=None, turns=[dict(
            question=dict(id='q', text='原始问题', focus='技能', source='llm'), answer='PRIVATE_ANSWER',
            response=dict(feedback=dict(strengths=['具体证据'], improvements=['核实原文'], reference_points=[])))])
        with app.state.store.connect() as db:
            db.execute("INSERT INTO resumes(id,name,sha256,file_path,source,text,chars,status,created_at,owner) VALUES(?,?,?,?,?,?,?,?,?,?)",
                       (resume, prefix+'.docx', prefix, '/private/file', 'docx', 'PRIVATE_RESUME', 14, 'ready', date, owner))
            for identifier, kind, payload, result in [(ingest, 'ingest', dict(resume_ids=[resume]), None),
                                                    (match, 'job_match', snapshot, [dict(job_id=job['job_id'])])]:
                db.execute("INSERT INTO tasks(id,kind,status,payload,result,created_at,updated_at) VALUES(?,?,'succeeded',?,?,?,?)",
                           (identifier, kind, json.dumps(payload), json.dumps(result) if result else None, date, date))
            db.execute("INSERT INTO interviews(id,resume_id,resume_text,jd_text,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
                       (interview, resume, 'PRIVATE_RESUME', job['jd_text'], json.dumps(state), 1577836800, 1577923200))
        app.state.store.grant_guest(owner, [resume, ingest, match, interview])
        return resume, ingest, match, interview

    def test_guest_isolation_pagination_and_metadata(self):
        owner = self.guest_owner(self.client)
        ids = self.seed(owner, 'a')
        stranger = CsrfClient(app)
        try:
            self.seed(self.guest_owner(stranger), 'b')
            response = self.client.get('/api/history?page_size=2')
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.headers['cache-control'], 'no-store')
            data = response.json()
            self.assertEqual((data['total'], len(data['items'])), (3, 2))
            second = self.client.get('/api/history?page_size=2&page=2').json()
            self.assertEqual(len(second['items']), 1)
            self.assertFalse(set(x['id'] for x in data['items']) & set(x['id'] for x in second['items']))
            self.assertNotIn('PRIVATE_', response.text)
            self.assertNotIn('/private/file', response.text)
            for kind, identifier in [('resume', ids[0]), ('job_match', ids[2]), ('interview', ids[3])]:
                self.assertEqual(stranger.get(f'/api/history/{kind}/{identifier}').status_code, 404)
                self.assertEqual(self.client.get('/api/history?kind='+kind).json()['total'], 1)
            for query in ('page=0', 'page_size=51', 'kind=unknown'):
                self.assertEqual(self.client.get('/api/history?'+query).status_code, 422)
        finally:
            stranger.close()

    def test_archive_preserves_snapshots_and_expired_interview(self):
        owner = self.guest_owner(self.client)
        r, ingest, match, interview = self.seed(owner, 'c')
        detail = self.client.get(f'/api/history/job_match/{match}').json()
        self.assertEqual(detail['match']['jobIndex']['cjob']['jd_text'], fixtures.JD)
        self.assertGreater(detail['match']['savedAt'], int((time.time()-10)*1000))
        self.assertEqual(self.client.get(f'/api/history/resume/{r}').json()['entry']['ingest_task_id'], ingest)
        archived = self.client.get(f'/api/history/interview/{interview}')
        self.assertEqual(archived.status_code, 200, archived.text)
        self.assertTrue(archived.json()['interview']['expired'])
        self.assertEqual(archived.json()['interview']['turns'][0]['answer'], 'PRIVATE_ANSWER')
        self.assertEqual(self.client.get(f'/api/interviews/{interview}').status_code, 410)
        self.assertEqual(self.client.post(f'/api/interviews/{interview}/answers', json={'question_id':'q','answer_text':'回答内容'*10}).status_code, 410)
        reopened = HistoryService(HistoryRepository(app.state.store)).list(owner, 'all', 1, 20)
        self.assertEqual(reopened['total'], 3)

    def test_same_account_on_new_client_and_no_guest_migration(self):
        guest = self.guest_owner(self.client)
        self.seed(guest, 'g')
        created = self.client.post('/api/auth/register', json={'username':'historyuser','password':'password1'})
        self.assertEqual(created.status_code, 201, created.text)
        user = self.client.get('/api/auth/me').json()['user']
        self.assertEqual(self.client.get('/api/history').json()['total'], 0)
        self.seed('user:'+user['id'], 'u')
        other = CsrfClient(app)
        try:
            login = other.post('/api/auth/login', json={'username':'historyuser','password':'password1'})
            self.assertEqual(login.status_code, 200, login.text)
            self.assertEqual(other.get('/api/history').json()['total'], 3)
            self.assertEqual(other.get('/api/history/resume/ur').status_code, 200)
            self.assertEqual(other.get('/api/history/resume/gr').status_code, 404)
            self.client.post('/api/auth/logout')
            self.assertEqual(self.client.get('/api/history').json()['total'], 3)
            self.assertEqual(self.client.get('/api/history/resume/ur').status_code, 404)
        finally:
            other.close()

    def test_conflicting_owner_rejected_even_with_resource_grant(self):
        owner = self.guest_owner(self.client)
        ids = self.seed('user:someone-else', 'x')
        app.state.store.grant_guest(owner, ids)
        self.assertEqual(self.client.get('/api/history').json()['total'], 0)
        for kind, identifier in [('resume', ids[0]), ('job_match', ids[2]), ('interview', ids[3])]:
            response = self.client.get(f'/api/history/{kind}/{identifier}')
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_recommendation_count_uses_visible_results_not_candidate_pool(self):
        owner = self.guest_owner(self.client)
        _, _, match, _ = self.seed(owner, 'n')
        with app.state.store.connect() as db:
            row = db.execute('SELECT payload FROM tasks WHERE id=?', (match,)).fetchone()
            payload = json.loads(row['payload'])
            payload['recommendation'] = True
            payload['jobs'] += [fixtures.fixture_job('candidate'+str(i)) for i in range(20)]
            db.execute('UPDATE tasks SET payload=? WHERE id=?', (json.dumps(payload), match))
        result = self.client.get('/api/history?kind=job_match').json()
        self.assertEqual(result['items'][0]['title'], '岗位推荐 · 1 个岗位')
