import { backupDownload } from "@/lib/backup";

// Download a backup from Settings (behind the UI's login prompt, like the
// rest of the UI).
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  return backupDownload((await params).name);
}
