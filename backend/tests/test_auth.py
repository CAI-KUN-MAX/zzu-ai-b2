import io
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from docx import Document
from fastapi.testclient import TestClient

from app.main import app
from app.ingestion import Store


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.test_directory = tempfile.TemporaryDirectory(prefix='auth-test-')
        self.directory = self.test_directory.name
        self.environment = patch.dict(os.environ, {'DATA_DIR': self.directory, 'OCR_PROVIDER': 'stub'})
        self.environment.start()
        self.context = TestClient(app)
        self.client = self.context.__enter__()
        self.client.get('/api/auth/me')

    def tearDown(self):
        self.context.__exit__(None, None, None)
        self.environment.stop()
        self.test_directory.cleanup()

    def post(self, path, **kwargs):
        return self.client.post(path, headers={'origin': 'http://testserver',
            'x-csrf-token': self.client.cookies.get('resume_csrf')}, **kwargs)

    def test_sessions_csrf_and_limits(self):
        self.assertEqual(self.client.post('/api/auth/logout').status_code, 403)
        self.assertEqual(self.post('/api/auth/register', json={'username': 'Student01', 'password': 'password1'}).status_code, 201)
        old_token = self.client.cookies.get('resume_session')
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['username'], 'student01')
        self.assertEqual(self.post('/api/auth/register', json={'username': 'student01', 'password': 'password1'}).status_code, 409)
        self.assertEqual(self.post('/api/auth/login', json={'username': 'student01', 'password': 'badpass1'}).status_code, 401)
        self.assertEqual(self.post('/api/auth/login', json={'username': 'student01', 'password': 'password1'}).status_code, 200)
        self.assertIsNone(app.state.auth.resolve(old_token))
        self.assertEqual(self.post('/api/auth/logout').json(), {'ok': True})
        self.assertFalse(self.client.get('/api/auth/me').json()['authenticated'])
        for _ in range(11):
            result = self.post('/api/auth/login', json={'username': 'student01', 'password': 'badpass1'})
        self.assertEqual(result.status_code, 429)
        self.assertIn('retry-after', result.headers)
        self.assertEqual(result.headers['cache-control'], 'no-store')

    def test_upload_isolation(self):
        document = Document()
        document.add_paragraph('教育背景 计算机本科 项目经历 Python 软件开发 ' * 10)
        data = io.BytesIO()
        document.save(data)
        payload = data.getvalue()
        first = self.post('/api/resumes/batch', files={'files': ('test.docx', payload)})
        self.assertEqual(first.status_code, 202, first.text)
        first_task = first.json()['task_id']
        first_id = json.loads(app.state.store.get('tasks', first_task)['payload'])['resume_ids'][0]
        self.assertEqual(self.post('/api/auth/register', json={'username': 'student02', 'password': 'password1'}).status_code, 201)
        self.assertEqual(self.client.get('/api/tasks/' + first_task).status_code, 404)
        second = self.post('/api/resumes/batch', files={'files': ('test.docx', payload)})
        self.assertEqual(second.status_code, 202, second.text)
        second_id = json.loads(app.state.store.get('tasks', second.json()['task_id'])['payload'])['resume_ids'][0]
        self.assertNotEqual(first_id, second_id)
        self.assertEqual(self.client.get('/api/resumes/' + first_id + '/text').status_code, 404)
        self.post('/api/auth/logout')
        self.assertEqual(self.client.get('/api/tasks/' + first_task).status_code, 200)
        self.assertEqual(self.client.get('/api/tasks/' + second.json()['task_id']).status_code, 404)

    def test_account_switch_and_expiry(self):
        self.assertEqual(self.post('/api/auth/register', json={'username': 'student_a', 'password': 'password1'}).status_code, 201)
        token_a = self.client.cookies.get('resume_session')
        document = Document()
        document.add_paragraph('教育背景 计算机本科 项目经历 Python 软件开发 ' * 10)
        data = io.BytesIO()
        document.save(data)
        task_a = self.post('/api/resumes/batch', files={'files': ('test.docx', data.getvalue())}).json()['task_id']
        self.assertEqual(self.post('/api/auth/register', json={'username': 'student_b', 'password': 'password1'}).status_code, 201)
        self.assertIsNone(app.state.auth.resolve(token_a))
        self.assertEqual(self.client.get('/api/tasks/' + task_a).status_code, 404)
        task_b = self.post('/api/resumes/batch', files={'files': ('test.docx', data.getvalue())}).json()['task_id']
        self.assertEqual(self.post('/api/auth/login', json={'username': 'student_a', 'password': 'password1'}).status_code, 200)
        self.assertEqual(self.client.get('/api/tasks/' + task_a).status_code, 200)
        self.assertEqual(self.client.get('/api/tasks/' + task_b).status_code, 404)
        with app.state.store.connect() as db:
            db.execute('UPDATE auth_sessions SET expires_at=0 WHERE user_id=(SELECT id FROM auth_users WHERE username=?)', ('student_a',))
        self.assertFalse(self.client.get('/api/auth/me').json()['authenticated'])
        self.assertEqual(self.client.get('/api/tasks/' + task_a).status_code, 404)
        response = self.client.post('/api/auth/logout', headers={'origin': 'http://untrusted.example', 'x-csrf-token': self.client.cookies.get('resume_csrf')})
        self.assertEqual(response.status_code, 403)


class LegacyMigrationTests(unittest.TestCase):
    def test_legacy_records_and_guest_acl_survive_restart(self):
        with tempfile.TemporaryDirectory(prefix='auth-migration-') as directory:
            path = Path(directory)
            with closing(sqlite3.connect(path / 'app.db')) as db, db:
                db.executescript("""
                    CREATE TABLE resumes (id TEXT PRIMARY KEY, name TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
                        file_path TEXT NOT NULL, source TEXT NOT NULL, text TEXT NOT NULL DEFAULT '',
                        chars INTEGER DEFAULT 0, pages INTEGER DEFAULT 0, provider TEXT DEFAULT '',
                        elapsed_ms INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'parsing',
                        error TEXT, created_at TEXT NOT NULL, low_conf INTEGER NOT NULL DEFAULT 0);
                    CREATE TABLE tasks (id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL,
                        stage TEXT DEFAULT '', progress INTEGER DEFAULT 0, payload TEXT DEFAULT '{}',
                        result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
                    INSERT INTO resumes (id,name,sha256,file_path,source,text,status,created_at,low_conf)
                        VALUES ('old','name','digest','old-file','docx','legacy text','ready','now',3);
                    INSERT INTO tasks (id,kind,status,payload,created_at,updated_at)
                        VALUES ('guest:old','guest_acl','succeeded','{"resources":["old"]}','now','now');
                """)
            store = Store(path)
            store.initialize()
            store.initialize()
            self.assertEqual(store.get('resumes', 'old')['text'], 'legacy text')
            self.assertEqual(store.get('resumes', 'old')['low_conf'], 3)
            self.assertEqual(json.loads(store.get('tasks', 'guest:old')['payload'])['resources'], ['old'])
            with store.connect() as db:
                db.execute("INSERT INTO resumes (id,name,sha256,file_path,source,created_at,owner) VALUES ('new','name','digest','new-file','docx','now','user:new')")
