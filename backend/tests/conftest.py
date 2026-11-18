import pytest
from fastapi.testclient import TestClient

from backend.config import Settings
from backend.main import create_app


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "study.db")


@pytest.fixture
def client(db_path):
    app = create_app(Settings(llm_enabled=False, database_path=db_path))
    with TestClient(app) as c:
        yield c
