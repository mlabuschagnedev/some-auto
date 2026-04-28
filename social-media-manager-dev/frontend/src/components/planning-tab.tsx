import { useEffect, useMemo, useState } from "react";
import {
  createPlanningRow,
  deletePlanningRow,
  importPlanningCsvs,
  loadPlanningPage,
  loadPlanningSheets,
  schedulePlanningRow,
  updatePlanningRow,
} from "../api";
import type {
  PlanningMonthOption,
  PlanningImportResult,
  PlanningPagePayload,
  PlanningRowRecord,
  PlanningSheetSummary,
  SessionPayload,
} from "../types";
import { PlanningCreativeModal } from "./planning-creative-modal";
import { EmptyState, SectionCard, StatusPill } from "./ui";

const PLANNING_COLUMNS: Array<{
  key: keyof PlanningRowRecord;
  label: string;
  type: "text" | "textarea" | "date" | "time" | "select" | "color";
}> = [
  { key: "linked_accounts", label: "Linked Accounts", type: "textarea" },
  { key: "job_nr", label: "Job Nr", type: "text" },
  { key: "job_color", label: "Color", type: "color" },
  { key: "date_value", label: "Date", type: "date" },
  { key: "time_value", label: "Time", type: "time" },
  { key: "theme", label: "Theme", type: "textarea" },
  { key: "post_copy", label: "Post Copy", type: "textarea" },
  { key: "link", label: "Link", type: "text" },
  { key: "format", label: "Format", type: "text" },
  { key: "final_creative", label: "Final Creative", type: "textarea" },
  { key: "deadline", label: "Deadline", type: "date" },
  { key: "mss_notes", label: "MSS Notes", type: "textarea" },
  { key: "designer", label: "Designer", type: "select" },
];

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function updateRowValue(
  rows: PlanningRowRecord[],
  rowId: number,
  field: keyof PlanningRowRecord,
  value: string,
): PlanningRowRecord[] {
  return rows.map((row) => (row.id === rowId ? { ...row, [field]: value } : row));
}

export function PlanningTab(props: {
  initialSheets: PlanningSheetSummary[];
  session: SessionPayload;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  canDeleteRows: boolean;
  onWorkspaceChanged: () => Promise<void> | void;
  onNotice: (message: string, tone?: "success" | "error") => void;
}) {
  const [sheets, setSheets] = useState<PlanningSheetSummary[]>(props.initialSheets);
  const [selectedPageId, setSelectedPageId] = useState<number | null>(
    props.initialSheets[0]?.page_id ?? null,
  );
  const [selectedMonth, setSelectedMonth] = useState(currentMonthKey());
  const [payload, setPayload] = useState<PlanningPagePayload | null>(null);
  const [rows, setRows] = useState<PlanningRowRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingRowId, setSavingRowId] = useState<number | null>(null);
  const [creativeRowId, setCreativeRowId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<PlanningImportResult | null>(null);

  useEffect(() => {
    setSheets(props.initialSheets);
    if (!props.initialSheets.some((sheet) => sheet.page_id === selectedPageId)) {
      setSelectedPageId(props.initialSheets[0]?.page_id ?? null);
    }
  }, [props.initialSheets]);

  async function refreshSheets(): Promise<void> {
    const items = await loadPlanningSheets(props.session, props.onSessionUpdate);
    setSheets(items);
    if (!items.some((sheet) => sheet.page_id === selectedPageId)) {
      setSelectedPageId(items[0]?.page_id ?? null);
    }
  }

  async function refreshPlanning(pageId = selectedPageId, month = selectedMonth): Promise<void> {
    if (!pageId) {
      setPayload(null);
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const nextPayload = await loadPlanningPage(
        props.session,
        props.onSessionUpdate,
        pageId,
        month,
      );
      setPayload(nextPayload);
      setRows(nextPayload.rows);
      setSelectedMonth(nextPayload.selected_month);
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to load planning rows.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshPlanning();
  }, [selectedPageId, selectedMonth]);

  const monthOptions: PlanningMonthOption[] = useMemo(
    () => payload?.month_options || [],
    [payload],
  );
  const activeCreativeRow = useMemo(
    () => rows.find((row) => row.id === creativeRowId) || null,
    [creativeRowId, rows],
  );

  async function handleCreateRow(isNonActionable: boolean): Promise<void> {
    if (!selectedPageId) {
      return;
    }
    try {
      const created = await createPlanningRow(
        props.session,
        props.onSessionUpdate,
        selectedPageId,
        {
          planning_month: selectedMonth,
          is_non_actionable: isNonActionable,
        },
      );
      setRows((current) => [...current, created].sort((a, b) => a.row_order - b.row_order));
      await refreshSheets();
      await props.onWorkspaceChanged();
      props.onNotice(isNonActionable ? "NA row created." : "Planning row created.", "success");
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to create the planning row.",
        "error",
      );
    }
  }

  async function handleSaveRowField(
    rowId: number,
    field: keyof PlanningRowRecord,
    value: string | boolean,
  ): Promise<void> {
    setSavingRowId(rowId);
    try {
      const updated = await updatePlanningRow(props.session, props.onSessionUpdate, rowId, {
        [field]: value,
      });
      setRows((current) => current.map((row) => (row.id === rowId ? updated : row)));
      await refreshSheets();
      await props.onWorkspaceChanged();
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to save the planning row.",
        "error",
      );
      await refreshPlanning();
    } finally {
      setSavingRowId(null);
    }
  }

  async function handleScheduleRow(rowId: number): Promise<void> {
    try {
      const result = await schedulePlanningRow(props.session, props.onSessionUpdate, rowId);
      setRows((current) =>
        current.map((row) => (row.id === rowId ? result.row : row)),
      );
      await refreshSheets();
      await props.onWorkspaceChanged();
      props.onNotice("Planning row scheduled.", "success");
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to schedule the planning row.",
        "error",
      );
    }
  }

  async function handleDeleteRow(rowId: number): Promise<void> {
    if (!window.confirm("Delete this planning row?")) {
      return;
    }
    try {
      await deletePlanningRow(props.session, props.onSessionUpdate, rowId);
      setRows((current) => current.filter((row) => row.id !== rowId));
      await refreshSheets();
      await props.onWorkspaceChanged();
      props.onNotice("Planning row deleted.", "success");
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to delete the planning row.",
        "error",
      );
    }
  }

  async function handleImportCsvs(): Promise<void> {
    setImporting(true);
    try {
      const result = await importPlanningCsvs(props.session, props.onSessionUpdate);
      setImportReport(result);
      await refreshSheets();
      await refreshPlanning();
      await props.onWorkspaceChanged();
      props.onNotice(result.message || "Planner CSV import finished.", "success");
    } catch (error) {
      props.onNotice(
        error instanceof Error ? error.message : "Unable to import planner CSVs.",
        "error",
      );
    } finally {
      setImporting(false);
    }
  }

  const isPastMonth =
    payload?.month_options.find((option) => option.value === selectedMonth)?.is_past || false;

  return (
    <>
      <div className="view-grid">
      <SectionCard
        title="Planning workspace"
        subtitle="Rows, creative management, CSV import, and activation workflows now run inside the React workspace."
        actions={
          <div className="inline-actions">
            {props.canDeleteRows ? (
              <button
                className="secondary-button"
                onClick={() => void handleImportCsvs()}
                type="button"
              >
                {importing ? "Importing..." : "Import CSV Inbox"}
              </button>
            ) : null}
            <button className="secondary-button" onClick={() => void refreshPlanning()} type="button">
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        }
      >
        {!sheets.length ? (
          <EmptyState text="Create a page first. Each page gets its own planning sheet automatically." />
        ) : (
          <>
            <div className="toolbar">
              <select
                className="search-input"
                onChange={(event) => setSelectedPageId(Number(event.target.value))}
                value={selectedPageId ?? ""}
              >
                {sheets.map((sheet) => (
                  <option key={sheet.page_id} value={sheet.page_id}>
                    {sheet.page_name}
                  </option>
                ))}
              </select>
              <select
                className="search-input"
                onChange={(event) => setSelectedMonth(event.target.value)}
                value={selectedMonth}
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.row_count})
                  </option>
                ))}
              </select>
              <div className="inline-actions">
                <button
                  className="secondary-button"
                  disabled={isPastMonth}
                  onClick={() => void handleCreateRow(true)}
                  type="button"
                >
                  NA row
                </button>
                <button
                  className="primary-button"
                  disabled={isPastMonth}
                  onClick={() => void handleCreateRow(false)}
                  type="button"
                >
                  Add row
                </button>
              </div>
            </div>

            <div className="planning-note">
              <StatusPill
                label={`Green required to schedule: ${
                  payload?.job_color_rules.required_to_schedule || "#34A853"
                }`}
                tone="warn"
              />
              <span>
                {isPastMonth
                  ? "Past months are reference-only. New rows and scheduling are disabled there."
                  : "Edit cells inline. Saves happen on blur and actions update rows immediately."}
              </span>
            </div>

            {importReport ? (
              <div className="import-report-card">
                <div className="metric-tray">
                  <div>
                    <p className="detail-label">Files Seen</p>
                    <strong>{importReport.files_seen}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Processed</p>
                    <strong>{importReport.files_processed}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Failed</p>
                    <strong>{importReport.files_failed}</strong>
                  </div>
                  <div>
                    <p className="detail-label">Rows Imported</p>
                    <strong>{importReport.rows_imported}</strong>
                  </div>
                </div>
                <p className="muted">{importReport.message}</p>
                <div className="table-shell">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Status</th>
                        <th>Page</th>
                        <th>Imported</th>
                        <th>Skipped</th>
                        <th>Months</th>
                        <th>Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importReport.report.map((item) => (
                        <tr key={item.file_name}>
                          <td>{item.file_name}</td>
                          <td>{item.status}</td>
                          <td>{item.page_name || "-"}</td>
                          <td>{item.rows_imported}</td>
                          <td>{item.rows_skipped}</td>
                          <td>{item.imported_months.join(", ") || "-"}</td>
                          <td>{item.issues.join(" | ") || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="planning-table-shell">
              <table className="planning-table">
                <thead>
                  <tr>
                    <th>Actions</th>
                    <th>Creative</th>
                    {PLANNING_COLUMNS.map((column) => (
                      <th key={column.key}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const scheduleDisabled =
                      row.is_non_actionable || !!row.scheduled_post_id || isPastMonth;

                    return (
                      <tr key={row.id}>
                        <td className="planning-actions-cell">
                          <div className="stack-actions">
                            {row.is_non_actionable ? (
                              <button
                                className="secondary-button"
                                onClick={() =>
                                  void handleSaveRowField(row.id, "is_non_actionable", false)
                                }
                                type="button"
                              >
                                Activate row
                              </button>
                            ) : (
                              <>
                                <button
                                  className="primary-button"
                                  disabled={scheduleDisabled}
                                  onClick={() => void handleScheduleRow(row.id)}
                                  type="button"
                                >
                                  Schedule now
                                </button>
                                <button
                                  className="secondary-button"
                                  onClick={() =>
                                    void handleSaveRowField(row.id, "is_non_actionable", true)
                                  }
                                  type="button"
                                >
                                  Disable row
                                </button>
                              </>
                            )}
                            {props.canDeleteRows ? (
                              <button
                                className="danger-button"
                                onClick={() => void handleDeleteRow(row.id)}
                                type="button"
                              >
                                Delete
                              </button>
                            ) : null}
                            {row.scheduled_post_id ? (
                              <StatusPill label={`Post #${row.scheduled_post_id}`} tone="good" />
                            ) : row.is_non_actionable ? (
                              <StatusPill label="NA row" tone="neutral" />
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="creative-cell">
                            {row.creative_media_url ? (
                              row.creative_media_url.match(/\.(mp4|mov|avi|webm)$/i) ? (
                                <video className="creative-preview" muted playsInline src={row.creative_media_url} />
                              ) : (
                                <img alt="Creative" className="creative-preview" src={row.creative_media_url} />
                              )
                            ) : (
                              <div className="creative-placeholder">No creative</div>
                            )}
                            <div className="creative-meta">
                              <span>{row.creative_media_count} files</span>
                              <button
                                className="secondary-button creative-manage-button"
                                onClick={() => setCreativeRowId(row.id)}
                                type="button"
                              >
                                Manage Creative
                              </button>
                            </div>
                          </div>
                        </td>
                        {PLANNING_COLUMNS.map((column) => {
                          const value = String(row[column.key] || "");

                          if (column.type === "textarea") {
                            return (
                              <td key={column.key}>
                                <textarea
                                  onBlur={(event) =>
                                    void handleSaveRowField(
                                      row.id,
                                      column.key,
                                      event.target.value,
                                    )
                                  }
                                  onChange={(event) =>
                                    setRows((current) =>
                                      updateRowValue(
                                        current,
                                        row.id,
                                        column.key,
                                        event.target.value,
                                      ),
                                    )
                                  }
                                  rows={4}
                                  value={value}
                                />
                              </td>
                            );
                          }

                          if (column.type === "select") {
                            return (
                              <td key={column.key}>
                                <select
                                  onChange={(event) => {
                                    const nextValue = event.target.value;
                                    setRows((current) =>
                                      updateRowValue(current, row.id, column.key, nextValue),
                                    );
                                    void handleSaveRowField(row.id, column.key, nextValue);
                                  }}
                                  value={value}
                                >
                                  <option value="">Unassigned</option>
                                  {(payload?.designer_options || []).map((designer) => (
                                    <option key={designer} value={designer}>
                                      {designer}
                                    </option>
                                  ))}
                                </select>
                              </td>
                            );
                          }

                          if (column.type === "color") {
                            return (
                              <td key={column.key}>
                                <div className="color-input-shell">
                                  <input
                                    onChange={(event) => {
                                      const nextValue = event.target.value.toUpperCase();
                                      setRows((current) =>
                                        updateRowValue(current, row.id, column.key, nextValue),
                                      );
                                    }}
                                    onBlur={(event) =>
                                      void handleSaveRowField(
                                        row.id,
                                        column.key,
                                        event.target.value.toUpperCase(),
                                      )
                                    }
                                    type="color"
                                    value={value || "#D9D9D9"}
                                  />
                                  <span>{value || "#D9D9D9"}</span>
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td key={column.key}>
                              <input
                                onBlur={(event) =>
                                  void handleSaveRowField(
                                    row.id,
                                    column.key,
                                    event.target.value,
                                  )
                                }
                                onChange={(event) =>
                                  setRows((current) =>
                                    updateRowValue(
                                      current,
                                      row.id,
                                      column.key,
                                      event.target.value,
                                    ),
                                  )
                                }
                                type={column.type}
                                value={value}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!rows.length ? <EmptyState text="No planning rows for this month yet." /> : null}
            {savingRowId ? <p className="banner">Saving row #{savingRowId}...</p> : null}
          </>
        )}
      </SectionCard>
      </div>
      <PlanningCreativeModal
        onClose={() => setCreativeRowId(null)}
        onSaved={(updatedRow) => {
          setRows((current) => current.map((row) => (row.id === updatedRow.id ? updatedRow : row)));
          setCreativeRowId(null);
          void props.onWorkspaceChanged();
          props.onNotice("Planning creatives saved.", "success");
        }}
        open={!!activeCreativeRow && !!payload?.page}
        page={payload?.page || null}
        row={activeCreativeRow}
        session={props.session}
        onSessionUpdate={props.onSessionUpdate}
      />
    </>
  );
}
