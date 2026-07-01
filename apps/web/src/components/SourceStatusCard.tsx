import { type SourceStatus } from "@sismica/shared";

import { formatUtcDateTime } from "../lib/presentation";

type SourceStatusCardProps = {
  statuses: SourceStatus[];
};

function getJobTone(status: SourceStatus["status"]): string {
  switch (status) {
    case "success":
      return "tone-success";
    case "error":
      return "tone-error";
    case "running":
      return "tone-running";
    default:
      return "tone-neutral";
  }
}

export function SourceStatusCard({ statuses }: SourceStatusCardProps) {
  return (
    <section className="source-monitor">
      <header className="source-monitor-heading">
        <strong>Fuentes operativas</strong>
        <span>{statuses.filter((status) => status.status === "success").length}/{statuses.length}</span>
      </header>
      <div className="source-monitor-list">
        {statuses.map((status) => (
          <div className="source-monitor-row" key={status.source} title={status.errorMessage ?? undefined}>
            <i className={getJobTone(status.status)} />
            <strong>{status.source.replace("_", " ")}</strong>
            <span>{formatUtcDateTime(status.lastRunFinishedAt)}</span>
            <small>
              {status.insertedCount}/{status.updatedCount}/{status.associatedCount}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
