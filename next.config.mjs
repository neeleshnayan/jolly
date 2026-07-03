/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf/docx parsers + native canvas are node libs — keep them out of the bundler
  serverExternalPackages: ["mammoth", "unpdf", "pdf-to-img", "canvas"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
