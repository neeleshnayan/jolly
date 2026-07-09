/** A score as a ring — the same number reads as progress, not a grade.
 *  Shared by the résumé editor's ATS panel and the Apply Kit's diagnostics. */
export default function AtsRing({ score, label = "keyword match" }: { score: number; label?: string }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  const cls = score >= 70 ? "good" : score >= 45 ? "mid" : "low";
  return (
    <svg className={`ats-ring ${cls}`} viewBox="0 0 60 60" width="60" height="60" role="img" aria-label={`${score}% ${label}`}>
      <circle className="ats-ring-track" cx="30" cy="30" r={r} />
      <circle className="ats-ring-fill" cx="30" cy="30" r={r} strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 30 30)" />
      <text x="30" y="35" textAnchor="middle" className="ats-ring-num">
        {score}%
      </text>
    </svg>
  );
}
