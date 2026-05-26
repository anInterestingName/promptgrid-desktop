import { createParser } from "eventsource-parser";

type ResponseTextState = {
  deltaText: string;
  doneText: string;
};

type ResponsesStreamState = {
  output: unknown[];
  text: ResponseTextState;
};

export function extractResponsesText(responseText: string) {
  return extractTextOutput(parseResponsesBody(responseText));
}

export function extractResponsesImageBase64(responseText: string) {
  return extractImageBase64(parseResponsesBody(responseText));
}

export function hasResponsesImageOutput(responseText: string) {
  return hasImageGenerationOutput(parseResponsesBody(responseText));
}

export function parseResponsesBody(responseText: string): unknown {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    return parseResponsesStream(responseText);
  }
}

function parseResponsesStream(responseText: string) {
  const state: ResponsesStreamState = {
    output: [],
    text: {
      deltaText: "",
      doneText: "",
    },
  };
  let completedResponse: unknown;
  const parser = createParser({
    onEvent(event) {
      const normalizedEvent = parseJsonEvent(event.data);
      if (!normalizedEvent) {
        return;
      }

      completedResponse = applyResponsesStreamEvent(normalizedEvent, state);
    },
  });

  parser.feed(responseText);
  parser.reset({ consume: true });

  if (completedResponse) {
    return completedResponse;
  }

  return {
    output_text: getPreferredText(state.text),
    output: state.output,
  };
}

function applyResponsesStreamEvent(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
) {
  const eventType = typeof event.type === "string" ? event.type : "";

  switch (eventType) {
    case "response.output_text.delta":
      if (typeof event.delta === "string") {
        state.text.deltaText += event.delta;
      }
      return undefined;

    case "response.output_text.done":
      if (typeof event.text === "string") {
        state.text.doneText = event.text;
      }
      return undefined;

    case "response.content_part.done": {
      const partText = extractTextContent((event as { part?: unknown }).part);
      if (partText) {
        state.text.doneText = partText;
      }
      return undefined;
    }

    case "response.output_item.done":
      captureOutputItem(event.item, state);
      return undefined;

    case "response.completed":
      return event.response
        ? mergeStreamTextIntoResponse(
            event.response,
            getPreferredText(state.text),
            state.output,
          )
        : undefined;

    default:
      if (eventType.includes("image_generation_call")) {
        captureImageEvent(event, state);
      }
      return undefined;
  }
}

function captureOutputItem(item: unknown, state: ResponsesStreamState) {
  const itemText = extractTextOutput(item);
  if (itemText) {
    state.text.doneText = itemText;
    return;
  }

  if (hasEventItemResult(item)) {
    state.output.push({
      type: "image_generation_call",
      result: item.result,
    });
    return;
  }

  if (item) {
    state.output.push(item);
  }
}

function captureImageEvent(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
) {
  if (typeof event.result === "string" && event.result.trim()) {
    state.output.push({
      type: "image_generation_call",
      result: event.result,
    });
    return;
  }

  if (hasEventItemResult(event.item)) {
    state.output.push({
      type: "image_generation_call",
      result: event.item.result,
    });
    return;
  }

  if (event.type !== "response.image_generation_call.partial_image" && event.item) {
    state.output.push(event.item);
  }
}

export function extractTextOutput(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const outputText = (responseJson as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = (responseJson as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        !item ||
        typeof item !== "object" ||
        (item as { type?: unknown }).type !== "message"
      ) {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      const text = content
        .map((contentItem) => extractTextContent(contentItem))
        .filter(Boolean)
        .join("\n");

      if (text) {
        return text;
      }
    }
  }

  return extractChatCompletionOutput(responseJson);
}

function mergeStreamTextIntoResponse(
  response: unknown,
  outputText: string,
  output: unknown[],
) {
  if (!response || typeof response !== "object") {
    return response;
  }

  if (extractTextOutput(response)) {
    return response;
  }

  const nextResponse = { ...(response as Record<string, unknown>) };
  const trimmedOutputText = outputText.trim();
  if (trimmedOutputText) {
    nextResponse.output_text = trimmedOutputText;
  }

  const existingOutput = Array.isArray(nextResponse.output)
    ? nextResponse.output
    : [];
  if (existingOutput.length === 0 && output.length > 0) {
    nextResponse.output = output;
  }

  return nextResponse;
}

function parseJsonEvent(data: string) {
  const trimmedData = data.trim();
  if (!trimmedData || trimmedData === "[DONE]") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmedData) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function getPreferredText(text: ResponseTextState) {
  return text.doneText || text.deltaText;
}

function hasEventItemResult(item: unknown): item is { result: string } {
  return (
    Boolean(item) &&
    typeof item === "object" &&
    typeof (item as { result?: unknown }).result === "string" &&
    Boolean((item as { result: string }).result.trim())
  );
}

function extractChatCompletionOutput(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const choices = (responseJson as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  for (const choice of choices) {
    const content =
      (choice as { message?: { content?: unknown }; text?: unknown }).message
        ?.content ?? (choice as { text?: unknown }).text;
    const output = extractTextContent(content);
    if (output) {
      return output;
    }
  }

  return "";
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    if (!content || typeof content !== "object") {
      return "";
    }

    const value =
      (content as { text?: unknown }).text ??
      (content as { output_text?: unknown }).output_text ??
      (content as { content?: unknown }).content;
    return typeof value === "string" ? value.trim() : "";
  }

  return content
    .map((item) => extractTextContent(item))
    .filter(Boolean)
    .join("\n");
}

function hasImageGenerationOutput(responseJson: unknown) {
  return Boolean(extractImageBase64(responseJson));
}

function extractImageBase64(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const output = (responseJson as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        !item ||
        typeof item !== "object" ||
        (item as { type?: unknown }).type !== "image_generation_call"
      ) {
        continue;
      }

      const result = (item as { result?: unknown }).result;
      if (typeof result === "string" && result.trim()) {
        return result.trim();
      }
    }
  }

  const data = (responseJson as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return "";
  }

  for (const image of data) {
    if (!image || typeof image !== "object") {
      continue;
    }

    const result =
      (image as { b64_json?: unknown }).b64_json ??
      (image as { url?: unknown }).url;
    if (typeof result === "string" && result.trim()) {
      return result.trim();
    }
  }

  return "";
}
