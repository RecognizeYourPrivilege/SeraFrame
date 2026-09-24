"""API error type shared by routes and storage."""


class APIError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = headers or {}


class PathRejected(APIError):
    def __init__(self) -> None:
        super().__init__(400, "path_rejected", "path rejected")
