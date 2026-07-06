/**
 * GET /api/resume/pdf?u=<userId> — a truly clean PDF (no browser date/URL
 * headers). Puppeteer renders the bare /resume/print page to A4 and streams it
 * back as a download. Session-first; ?u= works for dev.
 */
import { NextRequest, NextResponse } from "next/server";
import puppeteer from "puppeteer";
import { getFullProfile } from "@/lib/profile/read";
import { getSessionUserId } from "@/lib/auth/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  const userId = (await getSessionUserId()) ?? u;
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const full = await getFullProfile(userId);
  if (!full) return NextResponse.json({ error: "No résumé" }, { status: 404 });
  const name = (full.profile.fullName ?? "resume").replace(/[^\w\s-]/g, "").trim() || "resume";
  const fileName = `${name.replace(/\s+/g, "_")}.pdf`;

  const printUrl = `${req.nextUrl.origin}/resume/print?u=${encodeURIComponent(userId)}`;

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(printUrl, { waitUntil: "networkidle0", timeout: 30000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", bottom: "14mm", left: "14mm", right: "14mm" },
    });
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("[/api/resume/pdf]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "PDF failed" }, { status: 500 });
  } finally {
    await browser.close();
  }
}
