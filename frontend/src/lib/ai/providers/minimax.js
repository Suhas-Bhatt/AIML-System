import OpenAI from "openai";

/** Strip `<think>…</think>` reasoning blocks that M2+ models emit. */
function stripThinking(text) {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}

export class MinimaxProvider {
  id = "minimax";
  name = "MiniMax";
  models = [
    "MiniMax-M2.1-lightning",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.5",
    "MiniMax-M2.1",
    "MiniMax-Text-01",
    "abab6.5s-chat",
    "abab6.5-chat",
    "abab5.5-chat",
  ];
  defaultModel = "MiniMax-Text-01";

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.MINIMAX_API_KEY ?? "",
      baseURL: process.env.MINIMAX_BASE_URL ?? "https://api.minimax.chat/v1",
    });
  }

  toOpenAIMessages(messages) {
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  }

  async generateResponse(
    params
  ) {
    const response = await this.client.chat.completions.create({
      model: params.model ?? this.defaultModel,
      messages: this.toOpenAIMessages(params.messages),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 2048,
    });

    const choice = response.choices[0];
    return {
      content: stripThinking(choice.message.content ?? ""),
      finishReason: choice.finish_reason ?? "stop",
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *streamResponse(
    params
  ) {
    const stream = await this.client.chat.completions.create({
      model: params.model ?? this.defaultModel,
      messages: this.toOpenAIMessages(params.messages),
      temperature: params.temperature ?? 0.7,
      max_tokens: params.maxTokens ?? 2048,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
