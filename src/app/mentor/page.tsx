import MentorCall from "./MentorCall";

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ u?: string }>;
}) {
  const { u } = await searchParams;

  if (!u) {
    return (
      <main className="upload-wrap">
        <div className="upload-card">
          Missing user. <a href="/">Upload a résumé first →</a>
        </div>
      </main>
    );
  }

  return (
    <main className="upload-wrap">
      <MentorCall userId={u} />
    </main>
  );
}
