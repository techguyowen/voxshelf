import { ReaderView } from "@/components/ReaderView";

export default async function ReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ReaderView docId={id} />;
}
