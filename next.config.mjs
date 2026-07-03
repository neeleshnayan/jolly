/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdf/docx parsers are node libs — keep them out of the bundler
  serverExternalPackages: ["mammoth", "unpdf"],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
