import json
from openai import OpenAI, APITimeoutError
from typing import Optional


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
                break

            # Append the assistant turn (with tool_calls) to history
            messages.append(msg)

            # Execute each tool call (record args, send "ok" back)
            for tc in msg.tool_calls:
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}
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
