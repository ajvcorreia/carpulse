import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CarPulse",
  description: "Track car listing prices over time.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
