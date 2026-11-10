import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { TasksView } from "@/components/tasks/tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  await requireUser();
  return <TasksView params={await searchParams} />;
}
