import { useEffect, useMemo, useRef, useState } from "react";
import { uploadPlanningCreativeMedia } from "../api";
import type { PageRecord, PlanningRowRecord, SessionPayload } from "../types";

const INSTAGRAM_IMAGE_RATIO_MIN = 4 / 5;
const INSTAGRAM_IMAGE_RATIO_MAX = 1.91;
const INSTAGRAM_CROP_PRESETS = [
  { id: "portrait", label: "Portrait 4:5", ratio: 4 / 5 },
  { id: "square", label: "Square 1:1", ratio: 1 },
  { id: "landscape", label: "Landscape 1.91:1", ratio: 1.91 },
];

interface CreativeItem {
  id: string;
  kind: "existing" | "pending";
  path?: string;
  file?: File;
  name: string;
  type?: string;
  size: number;
  url: string;
  media_kind: "image" | "video";
  width: number | null;
  height: number | null;
  ratio_value: number | null;
  instagram_ratio_ok: boolean;
  ratio_error: string | null;
}

interface CropperState {
  itemId: string;
  sourceName: string;
  sourceType: string;
  sourceUrl: string;
  imageWidth: number;
  imageHeight: number;
  presetId: string;
  zoom: number;
  positionX: number;
  positionY: number;
}

let creativeTempSeed = 0;

function nextTempId(): string {
  creativeTempSeed += 1;
  return `pending-${creativeTempSeed}`;
}

function isVideoAsset(value: string): boolean {
  return /\.(mp4|mov|avi|mkv|webm)$/i.test(value);
}

function pageHasActivePlatform(page: PageRecord, platform: string): boolean {
  return page.social_accounts.some(
    (account) => account.is_active && account.platform.toLowerCase() === platform,
  );
}

function revokeItem(item: CreativeItem): void {
  if (item.kind === "pending" && item.url.startsWith("blob:")) {
    URL.revokeObjectURL(item.url);
  }
}

async function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = url;
  });
}

async function enrichItem(item: CreativeItem): Promise<CreativeItem> {
  if (item.media_kind === "video") {
    return {
      ...item,
      width: null,
      height: null,
      ratio_value: null,
      instagram_ratio_ok: true,
      ratio_error: null,
    };
  }

  try {
    const image = await loadImageElement(item.url);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const ratio = width / height;
    return {
      ...item,
      width,
      height,
      ratio_value: ratio,
      instagram_ratio_ok:
        ratio >= INSTAGRAM_IMAGE_RATIO_MIN - 0.01 &&
        ratio <= INSTAGRAM_IMAGE_RATIO_MAX + 0.01,
      ratio_error: null,
    };
  } catch (error) {
    return {
      ...item,
      width: null,
      height: null,
      ratio_value: null,
      instagram_ratio_ok: false,
      ratio_error: error instanceof Error ? error.message : "Could not inspect image.",
    };
  }
}

function chooseCropPreset(width: number, height: number) {
  const ratio = width / height;
  if (ratio < INSTAGRAM_IMAGE_RATIO_MIN) {
    return INSTAGRAM_CROP_PRESETS[0];
  }
  if (ratio > INSTAGRAM_IMAGE_RATIO_MAX) {
    return INSTAGRAM_CROP_PRESETS[2];
  }
  return INSTAGRAM_CROP_PRESETS.reduce((best, preset) =>
    Math.abs(ratio - preset.ratio) < Math.abs(ratio - best.ratio) ? preset : best,
  );
}

function cropStageSizeForRatio(ratio: number) {
  const maxWidth = Math.max(240, Math.min(360, window.innerWidth - 120));
  const maxHeight = Math.max(220, Math.min(360, window.innerHeight - 320));
  let width = maxWidth;
  let height = width / ratio;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function cropMetrics(cropper: CropperState) {
  const preset =
    INSTAGRAM_CROP_PRESETS.find((item) => item.id === cropper.presetId) ||
    INSTAGRAM_CROP_PRESETS[1];
  const stage = cropStageSizeForRatio(preset.ratio);
  const baseScale = Math.max(stage.width / cropper.imageWidth, stage.height / cropper.imageHeight);
  const renderScale = baseScale * cropper.zoom;
  const renderedWidth = cropper.imageWidth * renderScale;
  const renderedHeight = cropper.imageHeight * renderScale;
  const maxOffsetX = Math.max(0, renderedWidth - stage.width);
  const maxOffsetY = Math.max(0, renderedHeight - stage.height);
  const offsetX = -maxOffsetX * (cropper.positionX / 100);
  const offsetY = -maxOffsetY * (cropper.positionY / 100);
  return {
    preset,
    stageWidth: stage.width,
    stageHeight: stage.height,
    renderedWidth,
    renderedHeight,
    offsetX,
    offsetY,
    sourceX: Math.max(0, -offsetX / renderScale),
    sourceY: Math.max(0, -offsetY / renderScale),
    sourceWidth: Math.min(cropper.imageWidth, stage.width / renderScale),
    sourceHeight: Math.min(cropper.imageHeight, stage.height / renderScale),
  };
}

async function blobFromCanvas(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Failed to generate cropped image."));
        return;
      }
      resolve(blob);
    }, type, 0.92);
  });
}

export function PlanningCreativeModal(props: {
  open: boolean;
  row: PlanningRowRecord | null;
  page: PageRecord | null;
  session: SessionPayload;
  onSessionUpdate: (nextSession: SessionPayload | null) => void;
  onClose: () => void;
  onSaved: (row: PlanningRowRecord) => void;
}) {
  const [items, setItems] = useState<CreativeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [cropper, setCropper] = useState<CropperState | null>(null);
  const itemsRef = useRef<CreativeItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!props.open || !props.row) {
      if (!props.open) {
        itemsRef.current.forEach(revokeItem);
        itemsRef.current = [];
        setItems([]);
        setDirty(false);
        setCropper(null);
      }
      return;
    }
    itemsRef.current.forEach(revokeItem);
    const nextItems = (props.row.creative_media_paths || []).map((path, index) => ({
      id: `existing-${path}`,
      kind: "existing" as const,
      path,
      name: path.split("/").pop() || path,
      size: 0,
      type: undefined,
      url: props.row?.creative_media_urls?.[index] || `/uploads/${path}`,
      media_kind: isVideoAsset(path) ? ("video" as const) : ("image" as const),
      width: null,
      height: null,
      ratio_value: null,
      instagram_ratio_ok: true,
      ratio_error: null,
    }));

    setLoading(true);
    setDirty(false);
    setCropper(null);
    void Promise.all(nextItems.map((item) => enrichItem(item)))
      .then((enriched) => {
        setItems(enriched);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [props.open, props.row?.id, props.row?.updated_at]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach(revokeItem);
    };
  }, []);

  const instagramConnected = useMemo(
    () => (props.page ? pageHasActivePlatform(props.page, "instagram") : false),
    [props.page],
  );
  const mixedGuard = useMemo(
    () =>
      props.page
        ? pageHasActivePlatform(props.page, "instagram") &&
          pageHasActivePlatform(props.page, "facebook")
        : false,
    [props.page],
  );

  const violations = useMemo(() => {
    const nextViolations: string[] = [];
    const videoCount = items.filter((item) => item.media_kind === "video").length;
    const imageCount = items.length - videoCount;
    if (mixedGuard) {
      if (videoCount > 1) {
        nextViolations.push(
          "Pages connected to both Facebook and Instagram may contain only one video.",
        );
      }
      if (videoCount && imageCount) {
        nextViolations.push(
          "Pages connected to both Facebook and Instagram cannot mix images and videos in one row.",
        );
      }
    }
    if (instagramConnected) {
      const invalidImages = items.filter(
        (item) => item.media_kind === "image" && item.instagram_ratio_ok === false,
      );
      if (invalidImages.length) {
        nextViolations.push(
          "Instagram-connected rows require every image to stay inside the 4:5 to 1.91:1 feed ratio range.",
        );
      }
    }
    return nextViolations;
  }, [instagramConnected, items, mixedGuard]);

  function requestClose(): void {
    if (dirty) {
      const proceed = window.confirm("Discard unsaved creative changes?");
      if (!proceed) {
        return;
      }
    }
    itemsRef.current.forEach(revokeItem);
    itemsRef.current = [];
    setItems([]);
    setDirty(false);
    setCropper(null);
    props.onClose();
  }

  function replaceItems(nextItems: CreativeItem[]): void {
    setItems(nextItems);
    setDirty(true);
  }

  async function handleFilesAdded(fileList: FileList | null): Promise<void> {
    if (!fileList?.length) {
      return;
    }
    setLoading(true);
    const uploaded = await Promise.all(
      Array.from(fileList).map(async (file) =>
        enrichItem({
          id: nextTempId(),
          kind: "pending",
          file,
          name: file.name,
          size: file.size || 0,
          type: file.type || "application/octet-stream",
          url: URL.createObjectURL(file),
          media_kind: file.type.startsWith("video/") ? "video" : "image",
          width: null,
          height: null,
          ratio_value: null,
          instagram_ratio_ok: true,
          ratio_error: null,
        }),
      ),
    );
    setLoading(false);
    replaceItems([...itemsRef.current, ...uploaded]);
  }

  function moveItem(index: number, delta: number): void {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= items.length) {
      return;
    }
    const nextItems = [...items];
    const [item] = nextItems.splice(index, 1);
    nextItems.splice(targetIndex, 0, item);
    replaceItems(nextItems);
  }

  function removeItem(index: number): void {
    const target = items[index];
    if (!target) {
      return;
    }
    revokeItem(target);
    const nextItems = items.filter((_item, itemIndex) => itemIndex !== index);
    replaceItems(nextItems);
    if (cropper?.itemId === target.id) {
      setCropper(null);
    }
  }

  function openCropper(itemId: string): void {
    const item = items.find((entry) => entry.id === itemId);
    if (!item || item.media_kind === "video" || !item.width || !item.height) {
      return;
    }
    const preset = chooseCropPreset(item.width, item.height);
    setCropper({
      itemId: item.id,
      sourceName: item.name,
      sourceType: item.type || (item.name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg"),
      sourceUrl: item.url,
      imageWidth: item.width,
      imageHeight: item.height,
      presetId: preset.id,
      zoom: 1,
      positionX: 50,
      positionY: 50,
    });
  }

  async function applyCrop(): Promise<void> {
    if (!cropper) {
      return;
    }
    const currentIndex = items.findIndex((item) => item.id === cropper.itemId);
    if (currentIndex < 0) {
      return;
    }
    const metrics = cropMetrics(cropper);
    const image = await loadImageElement(cropper.sourceUrl);
    const outputWidth = Math.max(320, Math.round(metrics.sourceWidth));
    const outputHeight = Math.max(320, Math.round(metrics.sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = outputWidth;
    canvas.height = outputHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not start the crop canvas.");
    }
    context.drawImage(
      image,
      metrics.sourceX,
      metrics.sourceY,
      metrics.sourceWidth,
      metrics.sourceHeight,
      0,
      0,
      outputWidth,
      outputHeight,
    );

    const fileType = cropper.sourceType === "image/png" ? "image/png" : "image/jpeg";
    const extension = fileType === "image/png" ? "png" : "jpg";
    const baseName = cropper.sourceName.replace(/\.[^.]+$/, "").trim() || "creative";
    const blob = await blobFromCanvas(canvas, fileType);
    const file = new File([blob], `${baseName}-${metrics.preset.id}.${extension}`, {
      type: fileType,
    });
    const nextItem = await enrichItem({
      id: nextTempId(),
      kind: "pending",
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      url: URL.createObjectURL(file),
      media_kind: "image",
      width: null,
      height: null,
      ratio_value: null,
      instagram_ratio_ok: true,
      ratio_error: null,
    });

    const nextItems = [...items];
    revokeItem(nextItems[currentIndex]);
    nextItems[currentIndex] = nextItem;
    replaceItems(nextItems);
    setCropper(null);
  }

  async function handleSave(): Promise<void> {
    if (!props.row) {
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      const mediaOrder: string[] = [];
      const pendingOrder: string[] = [];
      for (const item of items) {
        if (item.kind === "existing" && item.path) {
          mediaOrder.push(`existing::${item.path}`);
          continue;
        }
        if (item.kind === "pending" && item.file) {
          const token = `pending::${item.id}`;
          mediaOrder.push(token);
          pendingOrder.push(token);
          formData.append("creative", item.file);
        }
      }
      formData.set("media_order", JSON.stringify(mediaOrder));
      formData.set("pending_order", JSON.stringify(pendingOrder));

      const updated = await uploadPlanningCreativeMedia(
        props.session,
        props.onSessionUpdate,
        props.row.id,
        formData,
      );
      setDirty(false);
      props.onSaved(updated);
    } finally {
      setSaving(false);
    }
  }

  if (!props.open || !props.row || !props.page) {
    return null;
  }

  const cropMetricsResult = cropper ? cropMetrics(cropper) : null;

  return (
    <div className="modal-backdrop">
      <section className="modal-panel creative-modal">
        <div className="section-heading">
          <div>
            <h2>Creative Box</h2>
            <p>
              Planner row #{props.row.row_order || props.row.id} for{" "}
              {props.row.job_nr || props.row.theme || "untitled work"}.
            </p>
          </div>
          <button className="secondary-button" onClick={requestClose} type="button">
            Close
          </button>
        </div>

        <div className="creative-manager-intro">
          <p className="muted">
            This order is locked into the scheduled post and is the exact order sent to social
            platforms.
          </p>
          {mixedGuard ? (
            <p className="muted">
              This page is connected to both Facebook and Instagram. Rows may contain images only
              or one video only.
            </p>
          ) : null}
          {instagramConnected ? (
            <p className="muted">
              Instagram image uploads must stay within the API-safe 4:5 to 1.91:1 feed range.
            </p>
          ) : null}
          {violations.length ? (
            <div className="warning-list">
              {violations.map((warning) => (
                <p className="inline-error" key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <div className="creative-grid">
          {items.length ? (
            items.map((item, index) => (
              <article className="creative-card" key={item.id}>
                <div className="creative-card-preview">
                  <span className="creative-order-badge">#{index + 1}</span>
                  {item.media_kind === "video" ? (
                    <video className="creative-card-media" controls src={item.url} />
                  ) : (
                    <img alt={item.name} className="creative-card-media" src={item.url} />
                  )}
                </div>
                <div className="creative-card-body">
                  <strong>{item.name}</strong>
                  <p className="muted">
                    {item.kind === "pending" ? "New" : "Saved"} {item.media_kind}
                    {item.size ? ` | ${Math.round(item.size / 1024)} KB` : ""}
                  </p>
                  {instagramConnected && item.media_kind === "image" ? (
                    item.ratio_error ? (
                      <p className="inline-error">{item.ratio_error}</p>
                    ) : item.width && item.height ? (
                      <p
                        className={
                          item.instagram_ratio_ok ? "muted creative-ratio-ok" : "inline-error"
                        }
                      >
                        {item.instagram_ratio_ok
                          ? `Instagram-safe ratio: ${item.width}x${item.height} (${(
                              item.ratio_value || 0
                            ).toFixed(2)}:1)`
                          : `Instagram requires 4:5 to 1.91:1. Current image is ${item.width}x${item.height} (${(
                              item.ratio_value || 0
                            ).toFixed(2)}:1).`}
                      </p>
                    ) : (
                      <p className="muted">Inspecting image ratio...</p>
                    )
                  ) : null}
                  <div className="inline-actions">
                    {item.media_kind === "image" ? (
                      <button
                        className="secondary-button"
                        onClick={() => openCropper(item.id)}
                        type="button"
                      >
                        Crop
                      </button>
                    ) : null}
                    <button
                      className="secondary-button"
                      disabled={index === 0}
                      onClick={() => moveItem(index, -1)}
                      type="button"
                    >
                      Earlier
                    </button>
                    <button
                      className="secondary-button"
                      disabled={index === items.length - 1}
                      onClick={() => moveItem(index, 1)}
                      type="button"
                    >
                      Later
                    </button>
                    <button
                      className="danger-button"
                      onClick={() => removeItem(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))
          ) : (
            <p className="empty-state">No creatives on this row yet.</p>
          )}
        </div>

        <div className="creative-upload-row">
          <label className="field">
            <span>Add Images or Videos</span>
            <input
              accept="image/*,video/*"
              onChange={(event) => void handleFilesAdded(event.target.files)}
              type="file"
              multiple
            />
          </label>
        </div>

        <div className="form-actions">
          <button
            className="primary-button"
            disabled={saving || loading}
            onClick={() => void handleSave()}
            type="button"
          >
            {saving ? "Saving..." : "Save Creatives"}
          </button>
          <button className="secondary-button" onClick={requestClose} type="button">
            Cancel
          </button>
        </div>
      </section>

      {cropper && cropMetricsResult ? (
        <section className="modal-panel cropper-modal">
          <div className="section-heading">
            <div>
              <h2>Instagram Cropper</h2>
              <p>Crop this image to an Instagram-safe feed ratio.</p>
            </div>
            <button className="secondary-button" onClick={() => setCropper(null)} type="button">
              Close
            </button>
          </div>

          <div className="cropper-layout">
            <div
              className="crop-stage"
              style={{
                width: `${cropMetricsResult.stageWidth}px`,
                height: `${cropMetricsResult.stageHeight}px`,
              }}
            >
              <img
                alt="Crop preview"
                className="crop-stage-image"
                src={cropper.sourceUrl}
                style={{
                  width: `${cropMetricsResult.renderedWidth}px`,
                  height: `${cropMetricsResult.renderedHeight}px`,
                  transform: `translate(${cropMetricsResult.offsetX}px, ${cropMetricsResult.offsetY}px)`,
                }}
              />
            </div>

            <div className="cropper-controls">
              <div className="inline-actions">
                {INSTAGRAM_CROP_PRESETS.map((preset) => (
                  <button
                    className={
                      cropper.presetId === preset.id ? "primary-button" : "secondary-button"
                    }
                    key={preset.id}
                    onClick={() => setCropper((current) => (current ? { ...current, presetId: preset.id } : current))}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <label className="field">
                <span>Zoom</span>
                <input
                  max="3"
                  min="1"
                  onChange={(event) =>
                    setCropper((current) =>
                      current ? { ...current, zoom: Number(event.target.value) } : current,
                    )
                  }
                  step="0.01"
                  type="range"
                  value={cropper.zoom}
                />
              </label>
              <label className="field">
                <span>Horizontal Position</span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setCropper((current) =>
                      current ? { ...current, positionX: Number(event.target.value) } : current,
                    )
                  }
                  step="1"
                  type="range"
                  value={cropper.positionX}
                />
              </label>
              <label className="field">
                <span>Vertical Position</span>
                <input
                  max="100"
                  min="0"
                  onChange={(event) =>
                    setCropper((current) =>
                      current ? { ...current, positionY: Number(event.target.value) } : current,
                    )
                  }
                  step="1"
                  type="range"
                  value={cropper.positionY}
                />
              </label>
              <p className="muted">
                Output preview: {cropMetricsResult.preset.label} at {cropMetricsResult.stageWidth} x{" "}
                {cropMetricsResult.stageHeight}
              </p>
              <div className="form-actions">
                <button className="primary-button" onClick={() => void applyCrop()} type="button">
                  Apply Crop
                </button>
                <button
                  className="secondary-button"
                  onClick={() => setCropper(null)}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
