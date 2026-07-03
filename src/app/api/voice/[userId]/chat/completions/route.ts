/**
 * Vapi custom-LLM endpoint. Vapi POSTs OpenAI-format chat requests here each
 * turn; we stream back OpenAI-format SSE chunks that Vapi speaks. The userId is
 * carried in the path (Vapi appends `/chat/completions` to the configured URL,
 * so the assistant's model.url is `.../api/voice/<userId>`).
 *
 * We ignore any incoming system message and build our own from the map — this
 * endpoint is the authoritative brain.
 */
import { mentorTurn } from "@/agents/mentor/turn";
import type { ChatMessage } from "@/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

interface OpenAIMessage {
  role: string;
  content: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const body = await req.json().catch(() => ({}));

  const incoming: ChatMessage[] = (body.messages ?? [])
    .filter((m: OpenAIMessage) => m.role === "user" || m.role === "assistant")
    .map((m: OpenAIMessage) => ({
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
    }));

  const encoder = new TextEncoder();
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const delta of mentorTurn({ userId, messages: incoming })) {
          send({
            id,
            object: "chat.completion.chunk",
            created,
            model: "mentor",
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
        }
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: "mentor",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        console.error("[voice/chat]", err);
        send({
          id,
          object: "chat.completion.chunk",
          created,
          model: "mentor",
          choices: [
            {
              index: 0,
              delta: { content: " Sorry, I lost my train of thought — say that again?" },
              finish_reason: "stop",
            },
          ],
        });
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
