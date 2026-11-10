import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { listBoard } from "@/lib/queries/board";
import { BoardView } from "@/components/board/board-view";

export const metadata: Metadata = { title: "Board" };

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  await requireUser();
  const params = await searchParams;
  const note = Array.isArray(params.note) ? params.note[0] : params.note;
  return <BoardView initialNotes={await listBoard()} focusId={note ?? null} />;
}
