import os
import time
import jwt
import bcrypt
from typing import Optional
from fastapi import Header

JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
JWT_ISS = "taro"
JWT_EXP_SECONDS = 60 * 60 * 24 * 7  # 1 week


def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def make_token(user_id: int, role: str, email: str) -> str:
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "role": role,
        "email": email,
        "iss": JWT_ISS,
        "iat": now,
        "exp": now + JWT_EXP_SECONDS,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def parse_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(
            token,
            JWT_SECRET,
            algorithms=["HS256"],
            options={"require": ["exp", "iat", "iss"]},
        )
    except Exception:
        return None


from fastapi import Header, HTTPException

def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = authorization.split(" ", 1)[1]
    decoded = parse_token(token)

    if not decoded:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return decoded
