import { checkApiKey } from "@/lib/api-auth";
import { backupDownload } from "@/lib/backup";

// Download one backup (a SQLite database file).
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const authError = checkApiKey(req);
  if (authError) return authError;

  return backupDownload((await params).name);
}
