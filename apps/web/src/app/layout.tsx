import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Inkforge Studio",
    template: "%s · Inkforge Studio",
  },
  description:
    "Forge books. Not prompts. The studio for drafting, humanizing and exporting KDP-compliant EPUB.",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
