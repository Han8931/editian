import json
import re
import logging
from openai import OpenAI, APITimeoutError
from typing import Optional, Generator

logger = logging.getLogger(__name__)


def get_client(
    provider: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
) -> OpenAI:
    if provider == "ollama":
        return OpenAI(
            base_url=base_url or "http://localhost:11434/v1",
            api_key="ollama",
        )
    elif provider == "openai":
        return OpenAI(api_key=api_key)
    else:
        # Any OpenAI-compatible endpoint (LM Studio, Groq, Together, etc.)
        return OpenAI(base_url=base_url, api_key=api_key or "none")


def _extract_tool_calls_from_content(
    content: str, tools: list[dict]
) -> list[tuple[str, dict]]:
    """
    Fallback: some local models (Ollama, LM Studio) write a tool call as plain
    text instead of returning structured tool_calls.  Try to recover it.

    Handled patterns (in order of preference):
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

    # ── 1 & 2: whole content is a JSON object ──────────────────────────────
    stripped = content.strip()
    try:
        data = json.loads(stripped)
        if isinstance(data, dict):
            if _try_named(data):
                return results
    except (json.JSONDecodeError, ValueError):
        pass

    # ── 3: <tool_call>...</tool_call> tags ─────────────────────────────────
    for m in re.finditer(r'<tool_call>(.*?)</tool_call>', content, re.DOTALL):
        try:
            data = json.loads(m.group(1).strip())
            if isinstance(data, dict):
                _try_named(data)
        except (json.JSONDecodeError, ValueError):
            pass
    if results:
        return results

    # ── 4: JSON blobs anywhere in the text ────────────────────────────────
    for m in re.finditer(r'\{[^{}]*\}', content, re.DOTALL):
        try:
            data = json.loads(m.group())
            if isinstance(data, dict):
                # Named call?
                if _try_named(data):
                    break
                # Raw args — check against required fields of each known tool
                for tname, tdef in known_names.items():
                    required = tdef["function"]["parameters"].get("required", [])
                    if required and all(k in data for k in required):
                        results.append((tname, data))
                        break
        except (json.JSONDecodeError, ValueError):
            pass

    return results


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
    Run a tool-calling agent loop until the model stops calling tools or
    max_iterations is reached.

    Returns a list of (tool_name, args_dict) for every tool call the model made.
    """
    client = get_client(provider, base_url, api_key)

    messages: list[dict] = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_message},
    ]

    all_calls: list[tuple[str, dict]] = []

    try:
        for i in range(max_iterations):
            kwargs: dict = {"model": model, "messages": messages, "tools": tools, "timeout": timeout}
            # On the first call, force the model to use a tool so it can't silently skip
            if force_tool_use and i == 0:
                kwargs["tool_choice"] = "required"
            response = client.chat.completions.create(**kwargs)

            choice = response.choices[0]
            msg = choice.message

            if not msg.tool_calls:
                content = msg.content or ""
                # Some models write tool calls as plain text — try to recover
                recovered = _extract_tool_calls_from_content(content, tools)
                if recovered:
                    print(f"[llm] recovered {len(recovered)} tool call(s) from content text")
                    all_calls.extend(recovered)
                else:
                    print(
                        f"[llm] WARNING: model produced no tool call on iteration {i}. "
                        f"finish_reason={choice.finish_reason!r} "
                        f"content={repr(content[:300])}"
                    )
                break

            # Append the assistant turn (with tool_calls) to history
            messages.append(msg)

            # Execute each tool call (record args, send "ok" back)
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
                print(f"[llm] tool_call: {tc.function.name}({json.dumps(args)[:200]})")
                all_calls.append((tc.function.name, args))
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps({"status": "applied"}),
                })

    except APITimeoutError:
        raise TimeoutError(
            f"The model took too long to respond (limit: {int(timeout)} s). "
            "Try a lighter model, or increase the timeout in Settings."
        )

    return all_calls


def run_text_revision(
    original_text: str,
    instruction: str,
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> str:
    """
    Tool-free fallback for models that can't produce structured tool calls.
    Ask the model to output the revised text directly as plain text.
    """
    client = get_client(provider, base_url, api_key)
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a text editor. Apply the instruction to the given text. "
                        "Output ONLY the revised text. "
                        "No explanation. No quotes around the output. No markdown."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Text:\n{original_text}\n\nInstruction: {instruction}",
                },
            ],
            timeout=timeout,
        )
        result = (response.choices[0].message.content or "").strip()
        print(f"[llm] text_revision fallback result: {repr(result[:200])}")
        return result
    except APITimeoutError:
        raise TimeoutError(
            f"The model took too long to respond (limit: {int(timeout)} s). "
            "Try a lighter model, or increase the timeout in Settings."
        )


def run_chat(
    system_prompt: str,
    messages: list[dict],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> str:
    """
    Send a multi-turn conversation to the model and return the assistant's reply.
    No tools — plain text response only.
    """
    client = get_client(provider, base_url, api_key)
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    try:
        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            timeout=timeout,
        )
        return response.choices[0].message.content or ""
    except APITimeoutError:
        raise TimeoutError(
            f"The model took too long to respond (limit: {int(timeout)} s). "
            "Try a lighter model, or increase the timeout in settings."
        )


def stream_chat(
    system_prompt: str,
    messages: list[dict],
    provider: str,
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    timeout: float = 120,
) -> Generator[str, None, None]:
    """
    Stream a chat response token-by-token.
    Yields plain text chunks as they arrive from the model.
    """
    client = get_client(provider, base_url, api_key)
    full_messages = [{"role": "system", "content": system_prompt}] + messages
    stream = client.chat.completions.create(
        model=model,
        messages=full_messages,
        timeout=timeout,
        stream=True,
    )
    for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
