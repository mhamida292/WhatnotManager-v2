/** @type {import('next').NextConfig} */
const nextConfig = { output: "standalone", serverExternalPackages: ["better-sqlite3", "@react-pdf/renderer"] };
export default nextConfig;
