import pytest

from backend.agents.agent_graph import IntentNode, SynthesisNode, ToolNode, build_graph
from backend.agents.intent import Intent


class FakeExtractor:
    async def extract_intent(self, task):
        assert task == "search laptops"
        return Intent(action="search_products", parameters={"product_name": "Laptop"}, confidence=0.9)


class FakeCaller:
    def __init__(self):
        self.db_seen = None

    async def call_tool(self, intent, auth_type, agent_id, db=None):
        self.db_seen = db
        return {
            "action": intent.action,
            "auth_type_used": auth_type,
            "agent_id": agent_id,
            "used_db": db is not None,
        }


@pytest.mark.asyncio
async def test_graph_nodes_accumulate_reasoning_and_pass_db():
    caller = FakeCaller()
    state = {
        "task": "search laptops",
        "auth_type": "oauth2",
        "agent_id": 42,
        "db": object(),
        "intent_result": None,
        "tool_result": None,
        "synthesis_result": None,
        "reasoning_steps": [],
    }

    intent_update = await IntentNode(FakeExtractor()).execute(state)
    state.update(intent_update)
    tool_update = await ToolNode(caller).execute(state)
    state.update(tool_update)
    synthesis_update = await SynthesisNode().execute(state)

    assert intent_update["intent_result"]["action"] == "search_products"
    assert tool_update["tool_result"]["used_db"] is True
    assert caller.db_seen is state["db"]
    assert synthesis_update["synthesis_result"]["summary"] == "Executed search_products"
    assert intent_update["reasoning_steps"][0]["node"] == "IntentNode"
    assert tool_update["reasoning_steps"][0]["node"] == "ToolNode"


def test_build_graph_compiles():
    assert build_graph() is not None
