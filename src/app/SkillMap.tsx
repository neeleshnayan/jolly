"use client";

/**
 * The skills-overlap map — one warm card, two homes:
 *   dashboard (mode "filter"): clicking a skill filters the ranked roles
 *   résumé editor (mode "view"): the gap is SHOWN, never auto-added — adding a
 *   skill is the user's own act (the redesign wizard asks explicitly), because
 *   a résumé is a promise, not a keyword bag.
 *
 * Missing skills lead (they're the actionable), each with a demand bar so the
 * market's pull is VISIBLE, not a number to decode. Skills you already show
 * sit below as quiet confirmation.
 */

/** `key` = canonical lowercase identity (selection/filtering); `skill` = the
 *  résumé-ready display form. Old API payloads may lack `key` — fall back. */
export type SkillMapEntry = { key?: string; skill: string; demand: number; have: boolean; avgFit: number };
const keyOf = (r: SkillMapEntry) => r.key ?? r.skill.toLowerCase();

export default function SkillMap({
  radar,
  mode,
  selected,
  onSelect,
}: {
  radar: SkillMapEntry[];
  mode: "filter" | "view";
  selected?: string | null;
  onSelect?: (skill: string | null) => void;
}) {
  if (!radar.length) return null;
  const missing = radar.filter((r) => !r.have);
  const have = radar.filter((r) => r.have);
  const maxDemand = Math.max(...radar.map((r) => r.demand), 1);

  return (
    <div className="skillmap">
      <div className="skillmap-head">
        <span className="skillmap-title">Skills across your matches</span>
        <span className="skillmap-sub">what the roles aligned with you keep asking for</span>
      </div>

      {missing.length > 0 && (
        <>
          <div className="skillmap-group">the market keeps asking — not on your résumé</div>
          <div className="skillmap-rows">
            {missing.map((r) => (
              <div
                key={keyOf(r)}
                className={`skillmap-row${selected === keyOf(r) ? " on" : ""}${mode === "filter" ? " clickable" : ""}`}
                onClick={mode === "filter" ? () => onSelect?.(selected === keyOf(r) ? null : keyOf(r)) : undefined}
                title={`${r.demand} aligned roles ask for this — it's not on your résumé yet`}
              >
                <span className="skillmap-skill">{r.skill}</span>
                <span className="skillmap-bar">
                  <i style={{ width: `${Math.max(12, Math.round((r.demand / maxDemand) * 100))}%` }} />
                </span>
                <span className="skillmap-count">{r.demand} role{r.demand === 1 ? "" : "s"}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {have.length > 0 && (
        <>
          <div className="skillmap-group have">already on your résumé</div>
          <div className="skillmap-haves">
            {have.map((r) => (
              <button
                key={keyOf(r)}
                className={`skillmap-havechip${selected === keyOf(r) ? " on" : ""}`}
                onClick={mode === "filter" ? () => onSelect?.(selected === keyOf(r) ? null : keyOf(r)) : undefined}
                disabled={mode !== "filter"}
                title={`${r.demand} aligned roles ask for this — you show it`}
              >
                ✓ {r.skill}
                <span className="skillmap-haven">×{r.demand}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {mode === "view" && missing.length > 0 && (
        <div className="skillmap-honesty">
          Gaps are shown, never auto-added — if one is genuinely yours, add it via + Skill (or the redesign wizard will ask).
        </div>
      )}
    </div>
  );
}
