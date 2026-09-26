from functools import lru_cache

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import get_settings

bearer = HTTPBearer(auto_error=False)


class Auth0Validator:
    def __init__(self, domain: str, audience: str):
        self.issuer = f"https://{domain}/"
        self.audience = audience
        self.jwks = jwt.PyJWKClient(
            f"{self.issuer}.well-known/jwks.json", cache_jwk_set=True,
            lifespan=300, timeout=5,
        )

    def validate(self, token: str) -> dict:
        key = self.jwks.get_signing_key_from_jwt(token)
        return jwt.decode(
            token, key.key, algorithms=["RS256"], audience=self.audience,
            issuer=self.issuer, options={"require": ["exp", "iss", "aud", "sub"]},
        )


@lru_cache
def get_validator() -> Auth0Validator:
    settings = get_settings()
    return Auth0Validator(settings.auth0_domain, settings.auth0_audience)


def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if credentials is None:
        raise HTTPException(401, "Bearer token required", headers={"WWW-Authenticate": "Bearer"})
    try:
        return get_validator().validate(credentials.credentials)
    except jwt.PyJWKClientConnectionError:
        raise HTTPException(503, "Authentication service unavailable") from None
    except jwt.PyJWTError:
        raise HTTPException(401, "Invalid access token", headers={"WWW-Authenticate": "Bearer"}) from None
