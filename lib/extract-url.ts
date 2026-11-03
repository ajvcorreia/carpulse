// The listing URL out of whatever was copied with it — share sheets and
// messages add text around it ("Check out this car on dubizzle: https://…").
// The first http(s) link wins, else a bare www. one; trailing punctuation
// that ends a sentence, and closing brackets with no opening one in the
// URL, are trimmed off.
export function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i) ?? text.match(/\bwww\.[^\s<>"'`]+/i);
  if (!match) return null;
  let url = match[0];
  for (;;) {
    const trimmed = url.replace(/[.,;:!?…'"’”]+$/, "");
    const last = trimmed.slice(-1);
    const open = ({ ")": "(", "]": "[", "}": "{" } as Record<string, string>)[last];
    const next = open && !trimmed.includes(open) ? trimmed.slice(0, -1) : trimmed;
    if (next === url) break;
    url = next;
  }
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
