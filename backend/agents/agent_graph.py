import time
from operator import add
from typing import Annotated, Any, TypedDict

from langgraph.graph import END, StateGraph


class ReasoningStep(TypedDict):
    node: str
    label: str
    duration_ms: float


class AgentState(TypedDict):
    task: str
    auth_type: str
    agent_id: int
    db: Any
    intent_result: dict | None
    tool_result: dict | None
    synthesis_result: dict | None
    reasoning_steps: Annotated[list[ReasoningStep], add]


class IntentNode:
    def __init__(self, extractor=None):
        from .intent import intent_extractor

        self._extractor = extractor or intent_extractor

    async def execute(self, state: AgentState) -> dict:
        start = time.perf_counter()
        intent = await self._extractor.extract_intent(state["task"])
        duration = (time.perf_counter() - start) * 1000
        return {
            "intent_result": intent.model_dump(),
            "reasoning_steps": [
                {
                    "node": "IntentNode",
                    "label": f"intent_extraction -> {intent.action}",
                    "duration_ms": duration,
                }
            ],
        }


class ToolNode:
    def __init__(self, caller=None):
        from .intent import tool_caller

        self._caller = caller or tool_caller

    async def execute(self, state: AgentState) -> dict:
        from .intent import Intent

        start = time.perf_counter()
        intent = Intent(**state["intent_result"])
        result = await self._caller.call_tool(
            intent,
            state["auth_type"],
            state["agent_id"],
            db=state["db"],
        )
        duration = (time.perf_counter() - start) * 1000
        return {
            "tool_result": result,
            "reasoning_steps": [
                {
                    "node": "ToolNode",
                    "label": f"tool_call -> {intent.action}",
                    "duration_ms": duration,
                }
            ],
        }


class SynthesisNode:
    async def execute(self, state: AgentState) -> dict:
        start = time.perf_counter()
        intent_result = state.get("intent_result") or {}
        tool_result = state.get("tool_result") or {}
        summary = f"Executed {intent_result.get('action', 'unknown')}"
        duration = (time.perf_counter() - start) * 1000
        return {
            "synthesis_result": {
                "summary": summary,
                "full_result": tool_result,
            },
            "reasoning_steps": [
                {
                    "node": "SynthesisNode",
                    "label": "synthesis -> final response compiled",
                    "duration_ms": duration,
                }
            ],
        }


def build_graph():
    graph = StateGraph(AgentState)
    intent_node = IntentNode()
    tool_node = ToolNode()
    synthesis_node = SynthesisNode()

    graph.add_node("intent", intent_node.execute)
    graph.add_node("tool", tool_node.execute)
    graph.add_node("synthesis", synthesis_node.execute)
    graph.set_entry_point("intent")
    graph.add_edge("intent", "tool")
    graph.add_edge("tool", "synthesis")
    graph.add_edge("synthesis", END)
    return graph.compile()
