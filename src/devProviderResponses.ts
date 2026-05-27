import { createParser } from "eventsource-parser";

type ResponseTextState = {
  deltaText: string;
  doneText: string;
};

type ResponseOutputItemState = {
  functionCallArguments: string;
  item: Record<string, unknown>;
  reasoningSummaryText: string;
  reasoningText: string;
};

type ResponsesStreamState = {
  currentOutputItemId?: string;
  output: ResponseOutputItemState[];
  outputIndexes: Map<string, number>;
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

export function extractResponsesError(responseText: string) {
  return extractResponseError(parseResponsesBody(responseText));
}

export function parseResponsesBody(responseText: string): unknown {
  try {
    return normalizeResponsesOutputItems(JSON.parse(responseText) as unknown);
  } catch {
    return parseResponsesStream(responseText);
  }
}

function parseResponsesStream(responseText: string) {
  const state: ResponsesStreamState = {
    outputIndexes: new Map(),
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
    output: getOutputItems(state),
  };
}

function applyResponsesStreamEvent(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
) {
  const eventType = typeof event.type === "string" ? event.type : "";

  switch (eventType) {
    case "response.output_item.added":
      captureStateOutputItem(event.item, state);
      return undefined;

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

    case "response.function_call_arguments.delta":
      if (typeof event.delta === "string") {
        appendFunctionCallArguments(
          ensureOutputItem(state, event, "function_call"),
          event.delta,
        );
      }
      return undefined;

    case "response.function_call_arguments.done": {
      const argumentsText =
        typeof event.arguments === "string"
          ? event.arguments
          : typeof event.text === "string"
            ? event.text
            : "";
      if (argumentsText) {
        setFunctionCallArguments(
          ensureOutputItem(state, event, "function_call"),
          argumentsText,
        );
      }
      return undefined;
    }

    case "response.reasoning.delta":
      if (typeof event.delta === "string") {
        appendReasoningText(
          ensureOutputItem(state, event, "reasoning"),
          event.delta,
        );
      }
      return undefined;

    case "response.reasoning_summary_text.delta":
      if (typeof event.delta === "string") {
        appendReasoningSummaryText(
          ensureOutputItem(state, event, "reasoning"),
          event.delta,
        );
      }
      return undefined;

    case "response.reasoning_summary_text.done":
    case "response.reasoning.done": {
      const text =
        typeof event.text === "string"
          ? event.text
          : typeof event.summary_text === "string"
            ? event.summary_text
            : "";
      if (text) {
        setReasoningSummaryText(
          ensureOutputItem(state, event, "reasoning"),
          text,
        );
      }
      return undefined;
    }

    case "response.completed":
      return event.response
        ? mergeStreamTextIntoResponse(
            event.response,
            getPreferredText(state.text),
            getOutputItems(state),
          )
        : undefined;

    case "response.failed":
      return mergeStreamTextIntoResponse(
        event.response ?? event,
        getPreferredText(state.text),
        getOutputItems(state),
      );

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
    captureStateOutputItem(item, state);
    return;
  }

  if (hasEventItemResult(item)) {
    captureStateOutputItem(
      {
        type: "image_generation_call",
        result: item.result,
      },
      state,
    );
    return;
  }

  if (item) {
    captureStateOutputItem(item, state);
  }
}

function captureImageEvent(
  event: Record<string, unknown>,
  state: ResponsesStreamState,
) {
  if (typeof event.result === "string" && event.result.trim()) {
    captureStateOutputItem(
      {
        type: "image_generation_call",
        result: event.result,
      },
      state,
    );
    return;
  }

  if (hasEventItemResult(event.item)) {
    captureStateOutputItem(
      {
        type: "image_generation_call",
        result: event.item.result,
      },
      state,
    );
    return;
  }

  if (
    event.type !== "response.image_generation_call.partial_image" &&
    event.item
  ) {
    captureStateOutputItem(event.item, state);
  }
}

function captureStateOutputItem(item: unknown, state: ResponsesStreamState) {
  if (!item || typeof item !== "object") {
    return;
  }

  const itemState = createOutputItemState(item as Record<string, unknown>);
  const itemId = typeof itemState.item.id === "string" ? itemState.item.id : "";
  if (itemId) {
    const existingIndex = state.outputIndexes.get(itemId);
    if (existingIndex !== undefined) {
      mergeOutputItemState(state.output[existingIndex], itemState);
      state.currentOutputItemId = itemId;
      return;
    }

    state.outputIndexes.set(itemId, state.output.length);
    state.currentOutputItemId = itemId;
  }

  state.output.push(itemState);
}

function ensureOutputItem(
  state: ResponsesStreamState,
  event: Record<string, unknown>,
  fallbackType: string,
) {
  const itemId =
    readEventItemId(event) ??
    (state.currentOutputItemId ? state.currentOutputItemId : undefined);

  if (itemId) {
    const existingIndex = state.outputIndexes.get(itemId);
    if (existingIndex !== undefined) {
      state.currentOutputItemId = itemId;
      return state.output[existingIndex];
    }

    const itemState = createOutputItemState({
      id: itemId,
      type: fallbackType,
    });
    state.outputIndexes.set(itemId, state.output.length);
    state.output.push(itemState);
    state.currentOutputItemId = itemId;
    return itemState;
  }

  const itemState = createOutputItemState({
    type: fallbackType,
  });
  state.output.push(itemState);
  return itemState;
}

function readEventItemId(event: Record<string, unknown>) {
  for (const key of ["item_id", "output_item_id", "id"]) {
    const value = event[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return undefined;
}

function createOutputItemState(
  item: Record<string, unknown>,
): ResponseOutputItemState {
  return {
    functionCallArguments:
      typeof item.arguments === "string" ? item.arguments : "",
    item: { ...item },
    reasoningSummaryText: extractReasoningSummaryText(item),
    reasoningText: "",
  };
}

function mergeOutputItemState(
  target: ResponseOutputItemState,
  source: ResponseOutputItemState,
) {
  if (!target.functionCallArguments.trim()) {
    target.functionCallArguments = source.functionCallArguments;
  }

  if (!target.reasoningSummaryText.trim()) {
    target.reasoningSummaryText = source.reasoningSummaryText;
  }

  if (!target.reasoningText.trim()) {
    target.reasoningText = source.reasoningText;
  }

  mergeJsonObject(target.item, source.item);
}

function appendFunctionCallArguments(
  itemState: ResponseOutputItemState,
  delta: string,
) {
  itemState.functionCallArguments += delta;
  itemState.item.arguments = itemState.functionCallArguments;
}

function setFunctionCallArguments(
  itemState: ResponseOutputItemState,
  argumentsText: string,
) {
  itemState.functionCallArguments = argumentsText;
  itemState.item.arguments = argumentsText;
}

function appendReasoningText(
  itemState: ResponseOutputItemState,
  delta: string,
) {
  itemState.reasoningText += delta;
  itemState.item.type ??= "reasoning";
  const content = Array.isArray(itemState.item.content)
    ? itemState.item.content
    : [];
  content.push({
    type: "reasoning_text",
    text: delta,
  });
  itemState.item.content = content;
}

function appendReasoningSummaryText(
  itemState: ResponseOutputItemState,
  delta: string,
) {
  itemState.reasoningSummaryText += delta;
  setReasoningSummaryText(itemState, itemState.reasoningSummaryText);
}

function setReasoningSummaryText(
  itemState: ResponseOutputItemState,
  text: string,
) {
  itemState.reasoningSummaryText = text;
  itemState.item.type ??= "reasoning";
  itemState.item.summary = [
    {
      type: "summary_text",
      text,
    },
  ];
}

function getOutputItems(state: ResponsesStreamState) {
  return state.output.map((itemState) => finalizeOutputItem(itemState));
}

function finalizeOutputItem(itemState: ResponseOutputItemState) {
  const item = { ...itemState.item };
  if (itemState.functionCallArguments.trim()) {
    item.arguments = itemState.functionCallArguments;
  }

  if (itemState.reasoningSummaryText.trim()) {
    item.summary = [
      {
        type: "summary_text",
        text: itemState.reasoningSummaryText,
      },
    ];
  }

  return item;
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

  const nextResponse = normalizeResponsesOutputItems(response) as Record<
    string,
    unknown
  >;
  const hasExtractableText = Boolean(extractTextOutput(nextResponse));
  if (hasExtractableText && output.length === 0) {
    return nextResponse;
  }

  const trimmedOutputText = outputText.trim();
  if (!hasExtractableText && trimmedOutputText) {
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

function normalizeResponsesOutputItems(response: unknown) {
  if (!response || typeof response !== "object") {
    return response;
  }

  const normalizedResponse = { ...(response as Record<string, unknown>) };
  const output = normalizedResponse.output;
  if (Array.isArray(output)) {
    normalizedResponse.output = output.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      return finalizeOutputItem(
        createOutputItemState(item as Record<string, unknown>),
      );
    });
  }

  return normalizedResponse;
}

function mergeJsonObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) {
      continue;
    }

    const existing = target[key];
    if (isPlainObject(existing) && isPlainObject(value)) {
      mergeJsonObject(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else if (existing === undefined || valueIsEmpty(existing)) {
      target[key] = value;
    }
  }
}

function valueIsEmpty(value: unknown) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return !value.trim();
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return isPlainObject(value) && Object.keys(value).length === 0;
}

function isPlainObject(value: unknown) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function extractResponseError(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const response = responseJson as {
    error?: unknown;
    message?: unknown;
    status?: unknown;
  };
  if (
    response.status !== "failed" &&
    (response.error === undefined || response.error === null)
  ) {
    return "";
  }

  if (response.error && typeof response.error === "object") {
    const errorMessage =
      (response.error as { message?: unknown }).message ??
      (response.error as { error?: unknown }).error;
    if (typeof errorMessage === "string" && errorMessage.trim()) {
      return errorMessage.trim();
    }
  }

  if (typeof response.message === "string" && response.message.trim()) {
    return response.message.trim();
  }

  return "Provider returned a failed response";
}

function extractReasoningSummaryText(item: Record<string, unknown>) {
  const summary = item.summary;
  if (!Array.isArray(summary)) {
    return "";
  }

  return summary
    .map((summaryItem) => extractTextContent(summaryItem))
    .filter(Boolean)
    .join("\n");
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
