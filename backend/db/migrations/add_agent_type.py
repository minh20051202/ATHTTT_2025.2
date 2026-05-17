import sys
from pathlib import Path

from sqlalchemy import inspect, text

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))

from backend.db.models import engine


with engine.begin() as conn:
    columns = {col["name"] for col in inspect(conn).get_columns("agents")}
    if "agent_type" not in columns:
        conn.execute(
            text("ALTER TABLE agents ADD COLUMN agent_type VARCHAR NOT NULL DEFAULT 'user'")
        )

print("Migration complete: agents.agent_type is present")
