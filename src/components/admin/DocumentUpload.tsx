"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UploadState {
  status: "idle" | "uploading" | "extracting" | "chunking" | "done" | "error";
  filename?: string;
  chunkCount?: number;
  error?: string;
  progress: number;
}

interface IngestedDoc {
  title: string;
  chunkCount: number;
}

interface IngestionHistoryEntry {
  id: string;
  filename: string;
  fileType: "pdf" | "docx";
  chunkCount: number;
  upserted: number;
  status: "ready" | "partial" | "failed";
  ocrUsed?: boolean;
  uploadedAt: string;
}

type UploadToast = {
  tone: "success" | "error";
  message: string;
};

export default function DocumentUpload({
  role,
  onUploaded,
}: {
  role: string;
  onUploaded?: () => void | Promise<void>;
}) {
  const [drag, setDrag] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ status: "idle", progress: 0 });
  const [docs, setDocs] = useState<IngestedDoc[]>([]);
  const [history, setHistory] = useState<IngestionHistoryEntry[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [toast, setToast] = useState<UploadToast | null>(null);
  const [policyKey, setPolicyKey] = useState("");
  const [version, setVersion] = useState("");
  const [visibility, setVisibility] = useState<string[]>(["employee", "manager", "hr_admin"]);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    if (role !== "hr_admin") {
      setDocs([]);
      setHistory([]);
      return;
    }

    setLoadingDocs(true);
    try {
      const res = await fetch("/api/ingest", {
        headers: { "x-user-role": role },
      });
      const data = (await res.json()) as
        | IngestedDoc[]
        | { docs?: IngestedDoc[]; history?: IngestionHistoryEntry[] };

      if (Array.isArray(data)) {
        setDocs(data);
        setHistory([]);
      } else {
        setDocs(Array.isArray(data.docs) ? data.docs : []);
        setHistory(Array.isArray(data.history) ? data.history : []);
      }
    } catch {
      setDocs([]);
      setHistory([]);
    } finally {
      setLoadingDocs(false);
    }
  }, [role]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDocs();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDocs]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToast(null);
    }, 2400);

    return () => window.clearTimeout(timer);
  }, [toast]);

  const uploadFile = async (file: File) => {
    if (!file) {
      return;
    }

    if (role !== "hr_admin") {
      setToast({
        tone: "error",
        message: "Unauthorized. HR admin role required.",
      });
      setUpload({
        status: "error",
        error: "Unauthorized. HR admin role required.",
        progress: 0,
      });
      return;
    }

    const ext = file.name.toLowerCase().split(".").pop();
    if (!["pdf", "docx"].includes(ext ?? "")) {
      setToast({
        tone: "error",
        message: "Only PDF and DOCX files supported.",
      });
      setUpload({
        status: "error",
        error: "Only PDF and DOCX files supported.",
        progress: 0,
      });
      return;
    }

    setUpload({ status: "uploading", filename: file.name, progress: 10 });

    const stageTimer1 = setTimeout(
      () => setUpload((prev) => ({ ...prev, status: "extracting", progress: 35 })),
      800,
    );
    const stageTimer2 = setTimeout(
      () => setUpload((prev) => ({ ...prev, status: "chunking", progress: 65 })),
      1800,
    );

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (policyKey.trim()) {
        formData.append("policyKey", policyKey.trim());
      }
      if (version.trim()) {
        formData.append("version", version.trim());
      }
      formData.append("visibility", visibility.join(","));

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "x-user-role": role },
        body: formData,
      });

      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);

      const data = (await res.json()) as {
        filename?: string;
        chunkCount?: number;
        error?: string;
      };

      if (!res.ok) {
        setToast({
          tone: "error",
          message: data.error ?? "Upload failed.",
        });
        setUpload({
          status: "error",
          error: data.error ?? "Upload failed.",
          progress: 0,
        });
        return;
      }

      setUpload({
        status: "done",
        filename: data.filename,
        chunkCount: data.chunkCount,
        progress: 100,
      });
      setToast({
        tone: "success",
        message: `Ingestion complete. ${data.chunkCount ?? 0} chunks are now queryable.`,
      });

      await loadDocs();
      await onUploaded?.();
    } catch {
      clearTimeout(stageTimer1);
      clearTimeout(stageTimer2);
      setToast({
        tone: "error",
        message: "Network error. Please try again.",
      });
      setUpload({
        status: "error",
        error: "Network error. Please try again.",
        progress: 0,
      });
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadFile(file);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so selecting the same file again still triggers an upload.
    e.target.value = "";
    if (file) {
      void uploadFile(file);
    }
  };

  const stageLabel: Record<string, string> = {
    uploading: "Uploading file...",
    extracting: "Extracting text...",
    chunking: "Generating chunks...",
    done: `Done - ${upload.chunkCount ?? 0} chunks created`,
    error: upload.error ?? "Error",
  };

  const stageColor: Record<string, string> = {
    uploading: "#6366F1",
    extracting: "#6366F1",
    chunking: "#6366F1",
    done: "#22C55E",
    error: "#EF4444",
  };

  if (role !== "hr_admin") {
    return null;
  }

  return (
    <div style={{ marginBottom: "2rem" }}>
      {toast ? (
        <div
          style={{
            marginBottom: "12px",
            padding: "10px 12px",
            borderRadius: "6px",
            border: `1px solid ${toast.tone === "success" ? "#14532D" : "#7F1D1D"}`,
            background: toast.tone === "success" ? "#102315" : "#2A1114",
            color: toast.tone === "success" ? "#86EFAC" : "#FCA5A5",
            fontSize: "12px",
            fontFamily: "Geist, sans-serif",
          }}
        >
          {toast.message}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: "8px", marginBottom: "10px" }}>
        <input
          value={policyKey}
          onChange={(event) => setPolicyKey(event.target.value)}
          placeholder="Policy key (e.g. annual-leave)"
          className="rounded-[6px] border border-[#1F1F21] bg-[#141415] px-3 py-2 text-xs outline-none"
        />
        <input
          value={version}
          onChange={(event) => setVersion(event.target.value)}
          placeholder="Version (e.g. 2026.1)"
          className="rounded-[6px] border border-[#1F1F21] bg-[#141415] px-3 py-2 text-xs outline-none"
        />
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "12px",
          marginBottom: "10px",
          fontSize: "12px",
          color: "#8C8C95",
        }}
      >
        <span>Visible to:</span>
        {(["employee", "manager", "hr_admin"] as const).map((item) => (
          <label key={item} style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
            <input
              type="checkbox"
              checked={visibility.includes(item)}
              disabled={item === "hr_admin"}
              onChange={() =>
                setVisibility((prev) =>
                  prev.includes(item) ? prev.filter((role) => role !== item) : [...prev, item],
                )
              }
            />
            {item}
          </label>
        ))}
        <span style={{ color: "#666" }}>Untick employee/manager for confidential documents.</span>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `1px dashed ${drag ? "#6366F1" : "#1F1F21"}`,
          borderRadius: "8px",
          padding: "32px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: drag ? "rgba(99,102,241,0.05)" : "#141415",
          transition: "all 0.15s ease",
          marginBottom: "16px",
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx"
          style={{ display: "none" }}
          onChange={onFileChange}
        />
        <div
          style={{
            fontSize: "24px",
            marginBottom: "8px",
            color: drag ? "#6366F1" : "#444",
          }}
        >
          ↑
        </div>
        <div
          style={{
            fontSize: "14px",
            color: "#fff",
            marginBottom: "4px",
            fontFamily: "Geist, sans-serif",
          }}
        >
          {drag ? "Drop to upload" : "Drag a PDF or DOCX here"}
        </div>
        <div
          style={{
            fontSize: "12px",
            color: "#666",
            fontFamily: "Geist, sans-serif",
          }}
        >
          or click to browse - max 20MB
        </div>
      </div>

      {upload.status !== "idle" ? (
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "6px",
              fontFamily: "Geist, sans-serif",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: stageColor[upload.status] ?? "#fff",
              }}
            >
              {stageLabel[upload.status]}
            </span>
            {upload.filename ? (
              <span
                style={{
                  fontSize: "12px",
                  color: "#666",
                  fontFamily: "Geist Mono, monospace",
                }}
              >
                {upload.filename}
              </span>
            ) : null}
          </div>
          <div
            style={{
              height: "3px",
              background: "#1F1F21",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${upload.progress}%`,
                background: stageColor[upload.status] ?? "#6366F1",
                borderRadius: "2px",
                transition: "width 0.4s ease",
              }}
            />
          </div>
          {upload.status === "done" ? (
            <button
              onClick={() => setUpload({ status: "idle", progress: 0 })}
              style={{
                marginTop: "8px",
                fontSize: "12px",
                color: "#666",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "Geist, sans-serif",
                padding: 0,
              }}
            >
              Upload another
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            color: "#666",
            fontFamily: "Geist, sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Ingested documents
        </span>
        <button
          onClick={() => void loadDocs()}
          style={{
            fontSize: "12px",
            color: "#6366F1",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: "Geist, sans-serif",
          }}
        >
          {loadingDocs ? "Loading..." : "Refresh"}
        </button>
      </div>

      {docs.length === 0 ? (
        <div
          style={{
            padding: "16px",
            border: "1px solid #1F1F21",
            borderRadius: "6px",
            fontSize: "13px",
            color: "#555",
            fontFamily: "Geist, sans-serif",
            textAlign: "center",
          }}
        >
          No documents uploaded yet. Upload a PDF or DOCX to get started.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {docs.map((doc) => (
            <div
              key={doc.title}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                border: "1px solid #1F1F21",
                borderRadius: "6px",
                background: "#141415",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  color: "#fff",
                  fontFamily: "Geist Mono, monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: "70%",
                }}
              >
                {doc.title}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  color: "#22C55E",
                  background: "rgba(34,197,94,0.1)",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  fontFamily: "Geist, sans-serif",
                  flexShrink: 0,
                }}
              >
                {doc.chunkCount} chunks
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: "16px" }}>
        <div
          style={{
            fontSize: "12px",
            color: "#666",
            fontFamily: "Geist, sans-serif",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            marginBottom: "8px",
          }}
        >
          Ingestion history
        </div>

        {history.length === 0 ? (
          <div
            style={{
              padding: "12px",
              border: "1px solid #1F1F21",
              borderRadius: "6px",
              fontSize: "12px",
              color: "#666",
              fontFamily: "Geist, sans-serif",
            }}
          >
            No ingestion events yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {history.map((entry) => (
              <div
                key={entry.id}
                style={{
                  border: "1px solid #1F1F21",
                  borderRadius: "6px",
                  padding: "10px 12px",
                  background: "#141415",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                  <span
                    style={{
                      fontSize: "12px",
                      color: "#fff",
                      fontFamily: "Geist Mono, monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.filename}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color:
                        entry.status === "ready"
                          ? "#22C55E"
                          : entry.status === "partial"
                            ? "#F59E0B"
                            : "#EF4444",
                    }}
                  >
                    {entry.status}
                  </span>
                </div>

                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "11px",
                    color: "#8C8C95",
                    fontFamily: "Geist, sans-serif",
                  }}
                >
                  {entry.chunkCount} chunks ({entry.upserted} upserted) · {entry.fileType.toUpperCase()}{entry.ocrUsed ? " · OCR" : ""} · {new Date(entry.uploadedAt).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
