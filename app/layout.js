import "./globals.css";
import { AuthProvider } from "../lib/AuthProvider";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ecology Consulting — Onboarding Workbook",
  description: "New employee onboarding workbook and Learning & Development modules for Ecology Consulting.",
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
