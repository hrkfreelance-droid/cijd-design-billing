-- Legacy project snapshots are separate from the V5 billing and payment ledger.
CREATE TABLE v5_project_history (
  project_id TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL CHECK (json_valid(snapshot))
);
