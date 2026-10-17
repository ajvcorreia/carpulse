import { checkApiKey } from "@/lib/api-auth";
import { readPhoto } from "@/lib/photos";

// The API-key twin of /photos/{id} (which sits behind the UI's login
// prompt instead), for clients that only hold the API key.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;
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
