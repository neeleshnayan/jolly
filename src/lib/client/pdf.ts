/**
 * Client-side PDF: try the server route (puppeteer, high-fidelity direct
 * download on Node); if it's unavailable — which it is on Cloudflare, where
 * puppeteer can't bundle and the route returns 501 — fall back to the browser's
 * own print engine. The résumé/letter print CSS (globals.css @media print)
 * already isolates the sheet to a clean A4 with REAL, selectable (ATS-friendly)
 * text — so `window.print()` → "Save as PDF" produces essentially what the
 * server did, using the user's own machine. No server, no puppeteer, no cost.
 *
 * Returns "download" | "print" so the caller can tailor its status message.
 */
export async function downloadOrPrintPdf(serverUrl: string, filename: string, init?: RequestInit): Promise<"download" | "print"> {
  try {
    const res = await fetch(serverUrl, init);
    if (!res.ok) throw new Error(`server pdf ${res.status}`);
    const blob = await res.blob();
    // a 501/HTML error body isn't a PDF — treat as unavailable
    if (blob.type && !blob.type.includes("pdf")) throw new Error("not a pdf");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return "download";
  } catch {
    // browser fallback — prints the visible sheet via the print CSS
    window.print();
    return "print";
  }
}
