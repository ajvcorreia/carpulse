import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { buildExport, exportFilename } from "@/lib/car-service";

export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return new NextResponse(JSON.stringify(await buildExport(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
    },
  });
}
