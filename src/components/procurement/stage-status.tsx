import { STAGE_LABEL, STAGE_TONE, type PoStage } from "@/lib/procurement";

/** Stage as a dot plus text: Requested is a hollow ring, Closed a filled grey dot (F091). */
export function StageStatus({ stage }: { stage: PoStage }) {
  return (
    <span className={`st c-${STAGE_TONE[stage]}${stage === "requested" ? " hollow" : ""}`}>
      {STAGE_LABEL[stage]}
    </span>
  );
}
