"""HTTP authentication request contract."""
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    username: str = Field(min_length=4, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_]{4,20}", value):
            raise ValueError("invalid username")
        return value.lower()

    @field_validator("password")
    @classmethod
    def validate_password_encoding(cls, value):
        try:
            value.encode("utf-8")
        except UnicodeEncodeError:
            raise ValueError("invalid password encoding") from None
        return value
