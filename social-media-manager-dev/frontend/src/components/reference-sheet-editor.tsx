import { useEffect, useRef, useState } from "react";
import type { ReferenceSheetPayload } from "../types";

const FONT_SIZES = [12, 14, 16, 18, 24, 32];

interface DraftSheet {
  title: string;
  columns: string[];
  rows: string[][];
}

function columnLabel(index: number): string {
  let value = Math.max(index, 0);
  let label = "";
  while (true) {
    const remainder = value % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor(value / 26) - 1;
    if (value < 0) {
      return label;
    }
  }
}

function blankRow(columnCount: number): string[] {
  return Array.from({ length: Math.max(1, columnCount) }, () => "");
}

function cloneDraft(payload: Pick<ReferenceSheetPayload, "title" | "columns" | "rows">): DraftSheet {
  return {
    title: payload.title || "",
    columns: [...(payload.columns || [])],
    rows: (payload.rows || []).map((row) => [...row]),
  };
}

export function ReferenceSheetEditor(props: {
  open: boolean;
  payload: ReferenceSheetPayload | null;
  saving: boolean;
  prefix: string;
  subtitle: string;
  onClose: () => void;
  onSave: (payload: DraftSheet) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<DraftSheet | null>(null);
  const [dirty, setDirty] = useState(false);
  const [activeCell, setActiveCell] = useState<{ rowIndex: number; columnIndex: number } | null>(null);
  const draftRef = useRef<DraftSheet | null>(null);

  useEffect(() => {
    if (!props.open || !props.payload) {
      setDraft(null);
      draftRef.current = null;
      setDirty(false);
      setActiveCell(null);
      return;
    }
    const nextDraft = cloneDraft(props.payload);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setDirty(false);
    setActiveCell(null);
  }, [props.open, props.payload]);

  function updateDraft(mutator: (current: DraftSheet) => DraftSheet): void {
    const current = draftRef.current;
    if (!current) {
      return;
    }
    const next = mutator(cloneDraft(current));
    draftRef.current = next;
    setDraft(next);
    setDirty(true);
  }

  function cellSelector(rowIndex: number, columnIndex: number): string {
    return `[data-reference-cell="${props.prefix}:${rowIndex}:${columnIndex}"]`;
  }

  function currentCellElement(): HTMLDivElement | null {
    if (!activeCell) {
      return null;
    }
    return document.querySelector<HTMLDivElement>(
      cellSelector(activeCell.rowIndex, activeCell.columnIndex),
    );
  }

  function syncCellValue(element: HTMLDivElement | null): void {
    const current = draftRef.current;
    if (!current || !element) {
      return;
    }
    const token = String(element.dataset.referenceCell || "");
    const parts = token.split(":");
    if (parts.length !== 3) {
      return;
    }
    const rowIndex = Number(parts[1]);
    const columnIndex = Number(parts[2]);
    if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
      return;
    }
    if (!Array.isArray(current.rows[rowIndex])) {
      return;
    }
    current.rows[rowIndex][columnIndex] = element.innerHTML === "<br>" ? "" : element.innerHTML;
    setDirty(true);
  }

  function syncActiveCellValue(): void {
    syncCellValue(currentCellElement());
  }

  function withActiveCell(run: (element: HTMLDivElement) => void): void {
    const element = currentCellElement();
    if (!element) {
      window.alert("Select a sheet cell first.");
      return;
    }
    element.focus();
    run(element);
    syncCellValue(element);
  }

  function applyCommand(command: string, value?: string): void {
    withActiveCell(() => {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, value);
    });
  }

  function applyFontSize(size: number): void {
    withActiveCell((element) => {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand("fontSize", false, "7");
      element.querySelectorAll('font[size="7"]').forEach((node) => {
        const span = document.createElement("span");
        span.style.fontSize = `${size}px`;
        span.innerHTML = node.innerHTML;
        node.replaceWith(span);
      });
    });
  }

  function requestClose(): void {
    if (dirty) {
      const proceed = window.confirm("Discard unsaved changes to this sheet?");
      if (!proceed) {
        return;
      }
    }
    props.onClose();
  }

  async function handleSave(): Promise<void> {
    syncActiveCellValue();
    if (!draftRef.current) {
      return;
    }
    await props.onSave(cloneDraft(draftRef.current));
  }

  if (!props.open || !props.payload || !draft) {
    return null;
  }

  const columns = draft.columns.length ? draft.columns : [columnLabel(0)];
  const rows = draft.rows.length ? draft.rows : [blankRow(columns.length)];

  return (
    <div className="modal-backdrop">
      <section className="modal-panel reference-sheet-modal">
        <div className="section-heading">
          <div>
            <h2>{props.payload.title || "Reference Sheet"}</h2>
            <p>{props.subtitle}</p>
          </div>
          <div className="inline-actions">
            <span className={dirty ? "status-pill status-pill-warn" : "status-pill"}>
              {dirty ? "Unsaved changes" : "Saved"}
            </span>
            <button className="secondary-button" onClick={requestClose} type="button">
              Close
            </button>
          </div>
        </div>

        <div className="reference-toolbar">
          <div className="inline-actions">
            <button className="secondary-button" onClick={() => applyCommand("bold")} type="button">
              Bold
            </button>
            <button className="secondary-button" onClick={() => applyCommand("italic")} type="button">
              Italic
            </button>
            <button
              className="secondary-button"
              onClick={() => applyCommand("underline")}
              type="button"
            >
              Underline
            </button>
            <button
              className="secondary-button"
              onClick={() => applyCommand("formatBlock", "<P>")}
              type="button"
            >
              Body
            </button>
            <button
              className="secondary-button"
              onClick={() => applyCommand("formatBlock", "<H1>")}
              type="button"
            >
              H1
            </button>
            <button
              className="secondary-button"
              onClick={() => applyCommand("formatBlock", "<H2>")}
              type="button"
            >
              H2
            </button>
            <button
              className="secondary-button"
              onClick={() => applyCommand("formatBlock", "<H3>")}
              type="button"
            >
              H3
            </button>
            <select
              className="search-input reference-font-size"
              defaultValue=""
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) {
                  applyFontSize(value);
                }
                event.target.value = "";
              }}
            >
              <option value="">Size</option>
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              onClick={() => applyCommand("removeFormat")}
              type="button"
            >
              Clear Format
            </button>
          </div>
          <div className="inline-actions">
            <input
              className="search-input reference-sheet-title"
              maxLength={120}
              onChange={(event) =>
                updateDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Sheet title"
              value={draft.title}
            />
            <button
              className="secondary-button"
              onClick={() =>
                updateDraft((current) => ({
                  ...current,
                  rows: [...current.rows, blankRow(columns.length)],
                }))
              }
              type="button"
            >
              Add Row
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                updateDraft((current) => ({
                  ...current,
                  columns: [...current.columns, columnLabel(current.columns.length)],
                  rows: current.rows.map((row) => [...row, ""]),
                }))
              }
              type="button"
            >
              Add Column
            </button>
          </div>
        </div>

        <div className="reference-sheet-wrap">
          <table className="reference-sheet-table">
            <thead>
              <tr>
                <th className="reference-index-head">#</th>
                {columns.map((label, columnIndex) => (
                  <th key={`column-${columnIndex}`}>
                    <div className="reference-column-head">
                      <input
                        maxLength={80}
                        onChange={(event) =>
                          updateDraft((current) => {
                            const nextColumns = [...current.columns];
                            nextColumns[columnIndex] = event.target.value || columnLabel(columnIndex);
                            return {
                              ...current,
                              columns: nextColumns,
                            };
                          })
                        }
                        value={label || columnLabel(columnIndex)}
                      />
                      <button
                        className="danger-button reference-delete"
                        disabled={columns.length <= 1}
                        onClick={() =>
                          updateDraft((current) => {
                            const nextColumns = current.columns.filter(
                              (_value, index) => index !== columnIndex,
                            );
                            const nextRows = current.rows.map((row) =>
                              row.filter((_value, index) => index !== columnIndex),
                            );
                            if (activeCell && activeCell.columnIndex >= nextColumns.length) {
                              setActiveCell(null);
                            }
                            return {
                              ...current,
                              columns: nextColumns,
                              rows: nextRows,
                            };
                          })
                        }
                        type="button"
                      >
                        X
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  <th className="reference-row-head">
                    <span>{rowIndex + 1}</span>
                    <button
                      className="danger-button reference-delete"
                      disabled={rows.length <= 1}
                      onClick={() =>
                        updateDraft((current) => {
                          const nextRows = current.rows.filter(
                            (_value, index) => index !== rowIndex,
                          );
                          if (activeCell && activeCell.rowIndex >= nextRows.length) {
                            setActiveCell(null);
                          }
                          return {
                            ...current,
                            rows: nextRows,
                          };
                        })
                      }
                      type="button"
                    >
                      X
                    </button>
                  </th>
                  {columns.map((_column, columnIndex) => {
                    const isActive =
                      activeCell?.rowIndex === rowIndex && activeCell?.columnIndex === columnIndex;
                    return (
                      <td
                        className={isActive ? "reference-grid-cell reference-grid-cell-active" : "reference-grid-cell"}
                        key={`cell-${rowIndex}-${columnIndex}`}
                      >
                        <div
                          className="reference-editor"
                          dangerouslySetInnerHTML={{ __html: row[columnIndex] || "" }}
                          data-reference-cell={`${props.prefix}:${rowIndex}:${columnIndex}`}
                          onBlur={(event) => syncCellValue(event.currentTarget)}
                          onFocus={() => setActiveCell({ rowIndex, columnIndex })}
                          onInput={(event) => syncCellValue(event.currentTarget)}
                          onMouseDown={() => setActiveCell({ rowIndex, columnIndex })}
                          contentEditable
                          suppressContentEditableWarning
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={props.saving}
            onClick={() => void handleSave()}
            type="button"
          >
            {props.saving ? "Saving..." : "Save Sheet"}
          </button>
          <button className="secondary-button" onClick={requestClose} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}
