/**
 * POST /api/cover-letters/pdf { content } — the letter as a clean A4 PDF.
 * Takes the text directly (the editor's current, possibly-unsaved draft) and
 * renders a minimal letter sheet: sender header from the profile, then the
 * body. Same Puppeteer path as the résumé PDF.
 */
import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { getFullProfile } from "@/lib/profile/read";
import { resolveUserId } from "@/lib/auth/user";

export const runtime = "nodejs";
export const maxDuration = 60;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { u?: string; content?: string };
  const userId = await resolveUserId(body.u);
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const content = (body.content ?? "").trim();
  if (content.length < 40) return NextResponse.json({ error: "Letter is empty" }, { status: 400 });

  const full = await getFullProfile(userId);
  const p = full?.profile;
  const name = (p?.fullName ?? "cover-letter").replace(/[^\w\s-]/g, "").trim() || "cover-letter";
  const style = (p?.styleConfig ?? {}) as { accent?: string; fontFamily?: string };
  const accent = typeof style.accent === "string" && /^#[0-9a-f]{3,8}$/i.test(style.accent) ? style.accent : "#2563eb";
  const font = typeof style.fontFamily === "string" && style.fontFamily ? style.fontFamily : "ui-sans-serif, system-ui, 'Segoe UI', Roboto, sans-serif";

  const paragraphs = content
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
  const contact = [p?.email, p?.phone, p?.location].filter(Boolean).map((c) => esc(String(c))).join(" · ");
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: ${font}; color: #1a1a1a; font-size: 13.5px; line-height: 1.65; margin: 0; }
    .head { border-bottom: 2px solid ${accent}; padding-bottom: 10px; margin-bottom: 22px; }
    .name { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; }
    .contact { color: #6b7280; font-size: 12px; margin-top: 4px; }
    .date { color: #6b7280; font-size: 12px; margin-bottom: 18px; }
    p { margin: 0 0 13px; }
  </style></head><body>
    <div class="head"><div class="name">${esc(p?.fullName ?? "")}</div><div class="contact">${contact}</div></div>
    <div class="date">${today}</div>
    ${paragraphs}
  </body></html>`;

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "18mm", right: "18mm" },
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${name.replace(/\s+/g, "_")}_cover_letter.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/cover-letters/pdf]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF failed" }, { status: 500 });
  } finally {
    await browser.close();
  }
}
