export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="content">
      <div className="card">
        <h1 className="content__title" style={{ marginBottom: 8 }}>
          {title}
        </h1>
        <p className="card__empty">This page isn't built yet.</p>
      </div>
    </div>
  );
}
