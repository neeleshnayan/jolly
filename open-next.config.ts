import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Cloudflare Workers deployment of the Next.js app (per-user path). Jobs
// ingestion stays local on the 4090. Defaults are fine to start; caching/queue
// overrides can come later. See jolly-compute-split memory.
export default defineCloudflareConfig();
