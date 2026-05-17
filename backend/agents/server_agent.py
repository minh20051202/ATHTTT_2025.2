from typing import AsyncIterator

from .agent_graph import build_graph


class ServerAgent:
    def __init__(self, graph=None):
        self._graph = graph or build_graph()

    async def stream_run(
        self,
        task: str,
        auth_type: str,
        agent_id: int,
        db,
    ) -> AsyncIterator[dict]:
        initial_state = {
            "task": task,
            "auth_type": auth_type,
            "agent_id": agent_id,
            "db": db,
            "intent_result": None,
            "tool_result": None,
            "synthesis_result": None,
            "reasoning_steps": [],
        }

        final_result = None
        async for chunk in self._graph.astream(initial_state, stream_mode="updates"):
            for _node_name, update in chunk.items():
                for step in update.get("reasoning_steps", []):
                    yield {"event": "reasoning", "data": step}
                if update.get("intent_result") is not None:
                    yield {"event": "intent_result", "data": update["intent_result"]}
                if update.get("tool_result") is not None:
                    yield {"event": "tool_result", "data": update["tool_result"]}
                if update.get("synthesis_result") is not None:
                    final_result = update["synthesis_result"]

        yield {"event": "done", "data": final_result}
