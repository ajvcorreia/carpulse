import { NextResponse } from "next/server";
import { buildExport, exportFilename } from "@/lib/car-service";

export async function GET() {
  return new NextResponse(JSON.stringify(await buildExport(), null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${exportFilename()}"`,
    },
  });
}
