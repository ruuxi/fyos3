import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClerkProvider } from '@clerk/nextjs'
import ConvexClientProvider from '@/components/ConvexClientProvider'

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "FromYou - AI Powered Desktop OS",
  description: "An AI-first infinite creation desktop and personal operating system. Build and run apps instantly through natural language, customize your environment, and share your creations.",
  keywords: [
    "AI OS",
    "AI Desktop",
    "AI Operating System",
    "Personal Environment",
    "App Builder",
    "WebContainer",
    "AI Agent",
    "Desktop Environment",
    "Custom Desktop",
    "AI-Powered Apps",
    "No-Code Platform",
    "Visual Desktop",
  ],
  authors: [{ name: "FromYou" }],
  creator: "FromYou",
  publisher: "FromYou",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://fromyou.io",
    title: "FromYou - AI Powered Desktop OS",
    description: "An AI first infinite creation desktop and personal operating system. Build and run apps instantly through natural language.",
    siteName: "FromYou",
  },
  twitter: {
    card: "summary_large_image",
    title: "FromYou - AI Powered Desktop OS",
    description: "An AI first infinite creation desktop and personal operating system. Build and run apps instantly through natural language.",
    creator: "@fromyou",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} antialiased`}>
        <ClerkProvider>
          <ConvexClientProvider>{children}</ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
