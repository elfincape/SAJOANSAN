export function WorkflowNavigation({
  steps,
}: {
  steps: readonly (readonly [id: string, label: string])[];
}) {
  return (
    <nav className="work-section-navigation" aria-label="작업 단계">
      {steps.map(([id, label], index) => (
        <a key={id} href={`#${id}`}>
          {index + 1} · {label}
        </a>
      ))}
    </nav>
  );
}
