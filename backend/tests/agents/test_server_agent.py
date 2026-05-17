import pytest

from backend.agents.server_agent import ServerAgent


class FakeGraph:
    async def astream(self, initial_state, stream_mode=None):
        assert initial_state["task"] == "search laptops"
        assert stream_mode == "updates"
        yield {
            "intent": {
                "reasoning_steps": [{"node": "IntentNode", "label": "intent", "duration_ms": 1.0}],
                "intent_result": {"action": "search_products"},
            }
        }
        yield {
            "tool": {
                "reasoning_steps": [{"node": "ToolNode", "label": "tool", "duration_ms": 2.0}],
                "tool_result": {"action": "search_products", "results": []},
            }
        }
        yield {
            "synthesis": {
                "reasoning_steps": [{"node": "SynthesisNode", "label": "done", "duration_ms": 0.1}],
                "synthesis_result": {"summary": "Executed search_products"},
            }
        }


@pytest.mark.asyncio
async def test_server_agent_stream_run_emits_typed_events():
    agent = ServerAgent(graph=FakeGraph())

    events = [
        item
        async for item in agent.stream_run("search laptops", "oauth2", 7, db=object())
    ]

    assert [event["event"] for event in events] == [
        "reasoning",
        "intent_result",
        "reasoning",
        "tool_result",
        "reasoning",
        "done",
    ]
    assert events[-1]["data"] == {"summary": "Executed search_products"}
