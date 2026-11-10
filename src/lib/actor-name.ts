/** "alex@example.com" → "Alex"; "system" → "System". */
export function actorName(actor: string): string {
  if (actor === "system") return "System";
  const local = actor.split("@")[0] ?? actor;
  const first = local.split(/[._-]/)[0] ?? local;
  return first ? first[0]!.toUpperCase() + first.slice(1) : actor;
}
