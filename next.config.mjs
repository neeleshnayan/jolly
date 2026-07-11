/** @type {import('next').NextConfig} */

// Cloudflare Workers build target (set by the opennextjs-cloudflare build). On CF,
// Node-native libs — puppeteer (PDF gen) and pdf-to-img/canvas (résumé vision
// render) — can't be bundled into a V8 Worker, so we alias them to empty and the
// routes that use them return 501 (guarded by DEPLOY_TARGET). Restored CF-native
// (Browser Rendering / client-side render) later. Local/Node builds are untouched.
const isCloudflare = process.env.DEPLOY_TARGET === "cloudflare";

const nextConfig = {
  // pdf/docx parsers + native canvas are node libs — keep them out of the bundler.
  // On CF the native ones are aliased to empty (below), so they must NOT also be
  // in serverExternalPackages (external wins over the alias → the require survives
  // and OpenNext bundles the .node). unpdf is edge-built and stays external.
  serverExternalPackages: isCloudflare
    ? ["mammoth", "unpdf"]
    : ["mammoth", "unpdf", "pdf-to-img", "canvas", "puppeteer", "puppeteer-core"],
  eslint: { ignoreDuringBuilds: true },
  webpack: (config) => {
    if (isCloudflare) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "pdf-to-img": false,
        canvas: false,
        puppeteer: false,
        "puppeteer-core": false,
      };
    }
    return config;
  },
};

export default nextConfig;
