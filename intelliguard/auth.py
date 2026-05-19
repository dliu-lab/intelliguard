from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

PASSWORD_ITERATIONS = 390_000
TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, iterations, salt, expected_digest = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False
    salt_bytes = base64.urlsafe_b64decode(salt.encode("ascii"))
    expected_bytes = base64.urlsafe_b64decode(expected_digest.encode("ascii"))
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, int(iterations))
    return hmac.compare_digest(actual, expected_bytes)


def new_session_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
