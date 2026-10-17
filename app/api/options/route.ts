import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/api-auth";
import { getCarFieldOptions } from "@/lib/data";

// Make/model/spec suggestions for the add/edit forms' autocomplete.
export async function GET(req: Request) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return NextResponse.json(await getCarFieldOptions());
}
