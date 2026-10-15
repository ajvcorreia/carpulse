import { readPhoto } from "@/lib/photos";

// Serves a downloaded listing photo (lib/photos.ts). Deliberately not under
// /api: proxy.ts's login prompt covers everything outside /api, and these are
// shown to the logged-in browser, not fetched by API-key scripts.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const photo = /^[0-9a-f-]{36}$/i.test(id) ? await readPhoto(id) : null;
  if (!photo) return new Response("Photo not found.", { status: 404 });

  return new Response(new Uint8Array(photo.bytes), {
    headers: {
      "Content-Type": photo.contentType,
      // A photo id is never reused for different bytes.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
