import "./globals.css";
import { Inter } from "next/font/google";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth/request";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
export const metadata = { title: "Warehouse Manager" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <Nav user={user ? { username: user.username, is_admin: user.is_admin } : null} />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      </body>
    </html>
  );
}
