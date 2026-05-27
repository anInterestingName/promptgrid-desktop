# Provider Responses API Debug Notes

This document records observed raw request/response shapes for provider calls.
Keep API keys and authorization headers out of this file.

## Text Model Test

Source: Tauri debug log `provider-requests-YYYY-MM-DD.jsonl`

Operation: `test_text_model`

Observed on: 2026-05-25

Provider/model: custom provider at `lyapi.cloud`, `gpt-5.5`

Request:

```json
{
  "method": "POST",
  "url": "https://lyapi.cloud/v1/responses",
  "body": {
    "model": "gpt-5.5",
    "input": [
      {
        "type": "message",
        "role": "user",
        "content": [
          {
            "type": "input_text",
            "text": "Reply with exactly: OK"
          }
        ]
      }
    ],
    "reasoning": {
      "effort": "xhigh"
    },
    "stream": true
  }
}
```

Observed response shape:

```text
event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"OK"}

event: response.output_text.done
data: {"type":"response.output_text.done","text":"OK"}

event: response.content_part.done
data: {"type":"response.content_part.done","part":{"type":"output_text","text":"OK"}}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"message","status":"completed","content":[{"type":"output_text","text":"OK"}]}}

event: response.completed
data: {"type":"response.completed","response":{"status":"completed","output":[]}}
```

Important compatibility note:

Some compatible providers send useful text in streaming events, but the final
`response.completed.response.output` may be an empty array. The parser must not
discard text accumulated from earlier stream events when the completed response
has no extractable text.

The same final text may appear in multiple stream events, including `delta`,
`done`, and `output_item.done`. The parser should treat `delta` as a fallback
stream accumulator and prefer the complete text from `done`/`output_item.done`
when present. Do not concatenate all three sources, or strict JSON parsing may
fail with trailing characters because the same JSON object was duplicated.

The parser should accept text from:

- `response.output_text.delta.delta`
- `response.output_text.done.text`
- `response.content_part.done.part.text`
- `response.output_item.done.item.content[].text`
- non-streaming `response.output_text`
- non-streaming `response.output[].content[].text`

## Codex Responses Wire Format

Unified provider requests now use Responses input items instead of plain string
`input`. A single prompt is sent as one user message:

```json
{
  "model": "model-id",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Prompt text"
        }
      ]
    }
  ]
}
```

Image generation keeps the same input item shape and adds the Responses image
tool:

```json
{
  "model": "image-model-id",
  "input": [
    {
      "type": "message",
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Image prompt"
        }
      ]
    }
  ],
  "tools": [
    {
      "type": "image_generation"
    }
  ],
  "tool_choice": {
    "type": "image_generation"
  }
}
```

Streaming reader support now covers these Responses events:

- `response.output_item.added`
- `response.output_text.delta`
- `response.output_text.done`
- `response.content_part.done`
- `response.output_item.done`
- `response.function_call_arguments.delta`
- `response.function_call_arguments.done`
- `response.reasoning.delta`
- `response.reasoning.done`
- `response.reasoning_summary_text.delta`
- `response.reasoning_summary_text.done`
- `response.completed`
- `response.failed`
- `response.image_generation_call.*`

Reasoning and function-call events are stored as output items; they are not
treated as the primary user-visible text. `response.failed` is converted into a
provider error before business handlers try to read text or images.

## Debug Log Location

Tauri initializes provider logs under the app log directory:

```text
%LOCALAPPDATA%\com.promptgrid.desktop\logs\debug-requests
```

File pattern:

```text
provider-requests-YYYY-MM-DD.jsonl
```

Each entry includes a sanitized `request` and `response`. Sensitive keys are
redacted by `debug_log.rs`.

## Related Fix

Prompt analysis now sends non-streaming Responses requests. It expects one
complete text payload and then parses the JSON directions from that payload.
This keeps structured JSON tasks away from provider-specific SSE duplication.

Image generation still uses streaming because providers can emit image results
through `image_generation_call` events. The stream parser keeps text deltas as
fallback only, prefers final text from done events, and collects image results
separately.

The browser development path uses the Vite proxy parser in `vite.config.ts`,
while the desktop Tauri path uses `src-tauri/src/model_config.rs`. Keep both
parsers aligned when adding provider compatibility handling. A mismatch can make
the in-browser app fail even when the packaged desktop command works.

Current parser ownership:

- Browser development proxy: `src/devProviderResponses.ts`
- Desktop/Tauri runtime: `src-tauri/src/model_config.rs`
- Business handlers should call text/image extraction helpers instead of reading
  SSE event names directly.
