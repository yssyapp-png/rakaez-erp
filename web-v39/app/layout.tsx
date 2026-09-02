import type { Metadata } from "next";
import "@fontsource-variable/cairo";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: "ركائز لقطع غيار السيارات",
  description: "منصة تشغيل متكاملة لمحلات ومستودعات قطع غيار السيارات وربطها بالورش.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
