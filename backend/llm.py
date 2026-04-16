"""
LLM utilities built on LangChain + LangGraph.

Public API (unchanged from the previous openai-based version):
  run_agent_loop(...)  -> list[tuple[str, dict]]
  run_text_revision(...) -> str
  stream_chat(...)     -> Generator[str, None, None]
  run_chat(...)        -> str
"""
from __future__ import annotations

import json
import re
import logging
from typing import Annotated, Generator, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import (
    SystemMessage,
    HumanMessage,
    AIMessage,
    ToolMessage,
    BaseMessage,
)
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

logger = logging.getLogger(__name__)


# ── Model factory ────────────────────────────────────────────────────────────

def _get_model(
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> ChatOpenAI:
    """Return a LangChain ChatOpenAI instance for any OpenAI-compatible provider."""
    if provider == "ollama":
        return ChatOpenAI(
            model=model,
            base_url=base_url or "http://localhost:11434/v1",
            api_key="ollama",
            timeout=timeout,
        )
    if provider == "openai":
        return ChatOpenAI(model=model, api_key=api_key, timeout=timeout)
    # Generic OpenAI-compatible endpoint (LM Studio, Groq, Together, custom, …)
    return ChatOpenAI(
        model=model,
        base_url=base_url,
        api_key=api_key or "none",
        timeout=timeout,
    )


def _to_lc_messages(messages: list[dict]) -> list[BaseMessage]:
    result: list[BaseMessage] = []
    for m in messages:
        if m["role"] == "user":
            result.append(HumanMessage(m["content"]))
        elif m["role"] == "assistant":
            result.append(AIMessage(m["content"]))
    return result


def _is_timeout(exc: Exception) -> bool:
    s = str(exc).lower()
    return "timeout" in s or "timed out" in s


# ── Garbled-output fallback parser ───────────────────────────────────────────

def _extract_tool_calls_from_content(
    content: str, tools: list[dict]
) -> list[tuple[str, dict]]:
    """
    Fallback: some local models write a tool call as plain text instead of
    returning structured tool_calls.  Try to recover it.

    Handled patterns (in order):
      1. {"name": "tool_name", "arguments": {...}}
      2. {"name": "tool_name", "parameters": {...}}
      3. <tool_call>{"name": "...", "arguments": {...}}</tool_call>
      4. Raw args JSON whose keys match a known tool's required params
    """
    if not content:
        return []

    known_names = {t["function"]["name"]: t for t in tools}
    results: list[tuple[str, dict]] = []

    def _try_named(data: dict) -> bool:
        name = data.get("name") or data.get("function") or data.get("tool_name")
        if not isinstance(name, str) or name not in known_names:
            return False
        args = data.get("arguments") or data.get("parameters") or data.get("args") or {}
        if not isinstance(args, dict):
            args = {}
        results.append((name, args))
        return True

    # 1 & 2: whole content is a JSON object
    stripped = content.strip()
    try:
        data = json.loads(stripped)
        if isinstance(data, dict) and _try_named(data):
            return results
    except (json.JSONDecodeError, ValueError):
        pass

    # 3: <tool_call>…</tool_call>
    for m in re.finditer(r"<tool_call>(.*?)</tool_call>", content, re.DOTALL):
        try:
            data = json.loads(m.group(1).strip())
            if isinstance(data, dict):
                _try_named(data)
        except (json.JSONDecodeError, ValueError):
            pass
    if results:
        return results

    # 4: any JSON blob whose required keys match a known tool
    for m in re.finditer(r"\{[^{}]*\}", content, re.DOTALL):
        try:
            data = json.loads(m.group())
            if not isinstance(data, dict):
                continue
            if _try_named(data):
                break
            for tname, tdef in known_names.items():
                required = tdef["function"]["parameters"].get("required", [])
                if required and all(k in data for k in required):
                    results.append((tname, data))
                    break
        except (json.JSONDecodeError, ValueError):
            pass

    return results


# ── LangGraph agent ──────────────────────────────────────────────────────────

class _AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    tool_calls: list[tuple[str, dict]]
    iteration: int


def _build_agent(
    lm: ChatOpenAI,
    tools: list[dict],
    force_tool_use: bool,
    max_iterations: int,
):
    """
    Compile a single-node LangGraph that calls the model in a loop until it
    stops producing tool calls (or max_iterations is reached).

    The graph accumulates (tool_name, args) pairs in state["tool_calls"].
    """
    lm_required = lm.bind_tools(tools, tool_choice="required") if force_tool_use else lm.bind_tools(tools)
    lm_auto = lm.bind_tools(tools)

    def call_model(state: _AgentState) -> dict:
        use_required = force_tool_use and state["iteration"] == 0
        bound = lm_required if use_required else lm_auto
        response: AIMessage = bound.invoke(state["messages"])

        new_messages: list[BaseMessage] = [response]
        new_calls = list(state["tool_calls"])

        if response.tool_calls:
            for tc in response.tool_calls:
                args = tc.get("args", {})
                print(f"[langgraph] tool_call: {tc['name']}({json.dumps(args)[:200]})")
                new_calls.append((tc["name"], args))
                new_messages.append(
                    ToolMessage(
                        content=json.dumps({"status": "applied"}),
                        tool_call_id=tc["id"],
                    )
                )
        else:
            content = response.content or ""
            recovered = _extract_tool_calls_from_content(content, tools)
            if recovered:
                print(f"[langgraph] recovered {len(recovered)} tool call(s) from content")
                new_calls.extend(recovered)
            else:
                print(
                    f"[langgraph] WARNING: no tool call on iteration {state['iteration']}. "
                    f"content={repr(content[:300])}"
                )

        return {
            "messages": new_messages,
            "tool_calls": new_calls,
            "iteration": state["iteration"] + 1,
        }

    def route(state: _AgentState) -> str:
        last = state["messages"][-1]
        if isinstance(last, ToolMessage) and state["iteration"] < max_iterations:
            return "continue"
        return END

    graph: StateGraph = StateGraph(_AgentState)
    graph.add_node("agent", call_model)
    graph.set_entry_point("agent")
    graph.add_conditional_edges("agent", route, {"continue": "agent", END: END})
    return graph.compile()


# ── Public API ───────────────────────────────────────────────────────────────

def run_agent_loop(
    system_prompt: str,
    user_message: str,
    tools: list[dict],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
    max_iterations: int = 10,
    force_tool_use: bool = True,
) -> list[tuple[str, dict]]:
    """
    Run an agent loop via LangGraph and return every tool call the model made
    as a list of (tool_name, args_dict) pairs.
    """
    lm = _get_model(provider, model, base_url, api_key, timeout)
    agent = _build_agent(lm, tools, force_tool_use, max_iterations)
    try:
        result = agent.invoke({
            "messages": [SystemMessage(system_prompt), HumanMessage(user_message)],
            "tool_calls": [],
            "iteration": 0,
        })
    except Exception as e:
        if _is_timeout(e):
            raise TimeoutError(
                f"The model took too long to respond (limit: {int(timeout)} s). "
                "Try a lighter model, or increase the timeout in Settings."
            )
        raise
    return result["tool_calls"]


def run_text_revision(
    original_text: str,
    instruction: str,
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
    allow_markdown: bool = False,
) -> str:
    """
    Tool-free fallback for models that can't produce structured tool calls.
    Ask the model to output the revised text directly.
    """
    lm = _get_model(provider, model, base_url, api_key, timeout)
    output_rule = (
        "No explanation. No quotes around the output. "
        "Output valid markdown source text."
        if allow_markdown
        else "No explanation. No quotes around the output. No markdown."
    )
    messages: list[BaseMessage] = [
        SystemMessage(
            "You are a text editor. Apply the instruction to the given text. "
            "Output ONLY the revised text. "
            f"{output_rule}"
        ),
        HumanMessage(f"Text:\n{original_text}\n\nInstruction: {instruction}"),
    ]
    try:
        response = lm.invoke(messages)
        result = (response.content or "").strip()
        print(f"[llm] text_revision fallback result: {repr(result[:200])}")
        return result
    except Exception as e:
        if _is_timeout(e):
            raise TimeoutError(
                f"The model took too long to respond (limit: {int(timeout)} s). "
                "Try a lighter model, or increase the timeout in Settings."
            )
        raise


def stream_chat(
    system_prompt: str,
    messages: list[dict],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> Generator[str, None, None]:
    """Stream a chat response token-by-token using LangChain streaming."""
    lm = _get_model(provider, model, base_url, api_key, timeout)
    lc_messages: list[BaseMessage] = [SystemMessage(system_prompt)] + _to_lc_messages(messages)
    try:
        for chunk in lm.stream(lc_messages):
            if chunk.content:
                yield chunk.content
    except Exception as e:
        if _is_timeout(e):
            raise TimeoutError(
                f"The model took too long to respond (limit: {int(timeout)} s). "
                "Try a lighter model, or increase the timeout in Settings."
            )
        raise


def run_chat(
    system_prompt: str,
    messages: list[dict],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> str:
    """Non-streaming chat — returns the full reply as a string."""
    return "".join(stream_chat(system_prompt, messages, provider, model, base_url, api_key, timeout))
