"""Account and opaque server-side session persistence."""
import hashlib
import hmac
import secrets
import sqlite3
import time
import uuid

SESSION_COOKIE = "resume_session"
SESSION_MAX_AGE = 7 * 24 * 60 * 60
_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1
_DUMMY_SALT = bytes.fromhex("9a735120ba79a91ca8790ebd81840d22")
_DUMMY_HASH = hashlib.scrypt(b"not-a-real-password", salt=_DUMMY_SALT, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)


def password_hash(password, salt):
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P)


def token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


class UsernameTaken(Exception):
    pass


class AuthStore:
    def __init__(self, store):
        self.store = store

    def initialize(self):
        with self.store.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS auth_users (
                    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                    salt BLOB NOT NULL, password_hash BLOB NOT NULL, created_at INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS auth_sessions (
                    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                    expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES auth_users(id)
                );
                CREATE TABLE IF NOT EXISTS auth_rate_limits (
                    bucket TEXT PRIMARY KEY, window INTEGER NOT NULL, attempts INTEGER NOT NULL
                );
            """)

    def allow_attempt(self, address, action, limit=10, seconds=60):
        """Atomically bound attempts per direct client address and operation."""
        timestamp = int(time.time())
        window = timestamp // seconds
        bucket = hashlib.sha256((action + "\0" + address).encode()).hexdigest()
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO auth_rate_limits(bucket,window,attempts) VALUES(?,?,1) "
                       "ON CONFLICT(bucket) DO UPDATE SET attempts=CASE WHEN window=excluded.window "
                       "THEN attempts+1 ELSE 1 END, window=excluded.window", (bucket, window))
            attempts = db.execute("SELECT attempts FROM auth_rate_limits WHERE bucket=? AND window=?",
                                  (bucket, window)).fetchone()[0]
        return attempts <= limit, seconds - timestamp % seconds

    def create_user(self, username, password):
        salt = secrets.token_bytes(16)
        digest = password_hash(password, salt)
        user = {"id": "usr_" + uuid.uuid4().hex, "username": username}
        try:
            with self.store.connect() as db:
                db.execute("INSERT INTO auth_users(id,username,salt,password_hash,created_at) VALUES(?,?,?,?,?)",
                           (user["id"], username, salt, digest, int(time.time())))
        except sqlite3.IntegrityError as exc:
            raise UsernameTaken() from exc
        return user

    def authenticate(self, username, password):
        with self.store.connect() as db:
            row = db.execute("SELECT id,username,salt,password_hash FROM auth_users WHERE username=?",
                             (username,)).fetchone()
        salt = row["salt"] if row else _DUMMY_SALT
        expected = row["password_hash"] if row else _DUMMY_HASH
        valid = hmac.compare_digest(password_hash(password, salt), expected)
        return {"id": row["id"], "username": row["username"]} if row and valid else None

    def new_session(self, user_id, old_token=""):
        token = secrets.token_hex(32)
        with self.store.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            if valid_token(old_token):
                db.execute("UPDATE auth_sessions SET revoked=1 WHERE token_hash=?", (token_hash(old_token),))
            db.execute("INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
                       (token_hash(token), user_id, int(time.time()) + SESSION_MAX_AGE))
        return token

    def resolve(self, token):
        if not valid_token(token):
            return None
        with self.store.connect() as db:
            row = db.execute("SELECT u.id,u.username FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id "
                             "WHERE s.token_hash=? AND s.revoked=0 AND s.expires_at>?",
                             (token_hash(token), int(time.time()))).fetchone()
        return dict(row) if row else None

    def revoke(self, token):
        if valid_token(token):
            with self.store.connect() as db:
                db.execute("UPDATE auth_sessions SET revoked=1 WHERE token_hash=?", (token_hash(token),))


def valid_token(token):
    return isinstance(token, str) and len(token) == 64 and all(c in "0123456789abcdef" for c in token)
