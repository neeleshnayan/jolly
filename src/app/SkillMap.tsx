"use client";

/**
 * The skills-overlap map — one warm card, two homes:
 *   dashboard (mode "filter"): clicking a skill filters the ranked roles
 *   résumé editor (mode "add"): clicking + drops the skill straight onto the sheet
 *
 * Missing skills lead (they're the actionable), each with a demand bar so the
 * market's pull is VISIBLE, not a number to decode. Skills you already show
 * sit below as quiet confirmation.
 */

export type SkillMapEntry = { skill: string; demand: number; have: boolean; avgFit: number };

export default function SkillMap({
  radar,
  mode,
  selected,
  onSelect,
  onAdd,
  adding,
  justAdded,
}: {
  radar: SkillMapEntry[];
  mode: "filter" | "add";
  selected?: string | null;
  onSelect?: (skill: string | null) => void;
  onAdd?: (skill: string) => void;
  adding?: string | null;
  justAdded?: Set<string>;
}) {
  if (!radar.length) return null;
  const missing = radar.filter((r) => !r.have && !justAdded?.has(r.skill));
  const have = radar.filter((r) => r.have || justAdded?.has(r.skill));
  const maxDemand = Math.max(...radar.map((r) => r.demand), 1);

  return (
    <div className="skillmap">
      <div className="skillmap-head">
        <span className="skillmap-title">Skills across your matches</span>
        <span className="skillmap-sub">what the roles aligned with you keep asking for</span>
      </div>

      {missing.length > 0 && (
        <>
          <div className="skillmap-group">worth adding</div>
          <div className="skillmap-rows">
            {missing.map((r) => (
              <div
                key={r.skill}
                className={`skillmap-row${selected === r.skill ? " on" : ""}${mode === "filter" ? " clickable" : ""}`}
                onClick={mode === "filter" ? () => onSelect?.(selected === r.skill ? null : r.skill) : undefined}
                title={`${r.demand} aligned roles ask for this — it's not on your résumé yet`}
              >
                <span className="skillmap-skill">{r.skill}</span>
                <span className="skillmap-bar">
                  <i style={{ width: `${Math.max(12, Math.round((r.demand / maxDemand) * 100))}%` }} />
                </span>
                <span className="skillmap-count">{r.demand} role{r.demand === 1 ? "" : "s"}</span>
                {mode === "add" && (
                  <button
                    className="skillmap-add"
                    disabled={!!adding}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAdd?.(r.skill);
                    }}
                    title="Add to your résumé's Skills — only if you genuinely have it"
                  >
                    {adding === r.skill ? "…" : "+ Add"}
                  </button>
                )}
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
                key={r.skill}
                className={`skillmap-havechip${selected === r.skill ? " on" : ""}`}
                onClick={mode === "filter" ? () => onSelect?.(selected === r.skill ? null : r.skill) : undefined}
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
      {mode === "add" && missing.length > 0 && (
        <div className="skillmap-honesty">Add only what&apos;s genuinely yours — the sheet is a promise, not a keyword bag.</div>
      )}
    </div>
  );
}
