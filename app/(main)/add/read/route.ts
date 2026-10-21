import { fetchListingDetails } from "@/lib/car-service";

export const dynamic = "force-dynamic";

// What the add-car form calls to pre-fill itself (behind the UI's login
// prompt): reads the listing and streams newline-delimited JSON — a
// {step, state, detail} line as each scraper step starts and ends, then
// {result} — so the form can tick the steps off as they happen.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        const result = await fetchListingDetails(url, (step, state, detail) => send({ step, state, detail }));
        send({ result });
      } catch (err) {
        send({ result: { kind: "error", message: err instanceof Error ? err.message : "Couldn't read the listing." } });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" },
  });
}
