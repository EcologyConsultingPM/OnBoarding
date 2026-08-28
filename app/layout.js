import "./globals.css";
import { AuthProvider } from "../lib/AuthProvider";

export const dynamic = "force-dynamic";

export const metadata = {
  metadataBase: new URL("https://www.ecologyconsultingsaas.app"),
  applicationName: "Ecology Consulting Staff Portal",
  title: {
    default: "Ecology Consulting | Staff Portal",
    template: "%s | Ecology Consulting",
  },
  description:
    "Ecology Consulting's secure staff workspace for project tasks, learning, WHS forms, governance and timesheet reference.",
  keywords: [
    "Ecology Consulting",
    "staff portal",
    "project management",
    "learning and development",
    "WHS",
  ],
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Ecology Consulting Staff Portal",
    title: "Ecology Consulting | Staff Portal",
    description:
      "Your secure workspace for project tasks, learning, WHS forms, governance and timesheet reference.",
  },
  twitter: {
    card: "summary",
    title: "Ecology Consulting | Staff Portal",
    description:
      "Your secure workspace for project tasks, learning, WHS forms, governance and timesheet reference.",
  },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png", sizes: "512x512" }],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-icon.png", type: "image/png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en-AU">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
