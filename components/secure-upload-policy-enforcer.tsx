"use client";

import { useEffect, useState } from "react";

const SAFE_ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt";
const SAFE_EXTENSIONS = new Set(["pdf", "docx", "xlsx", "csv", "txt"]);
const LEGACY_OR_UNINSPECTABLE = new Set([".doc", ".xls", ".ods", ".ppt", ".pptx", ".rtf", ".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function acceptTokens(input: HTMLInputElement): string[] {
  return (input.getAttribute("accept") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function isKnowledgeDocumentPicker(input: HTMLInputElement): boolean {
  if (input.type !== "file") return false;
  const tokens = acceptTokens(input);
  const containsOfficeOrPdf = tokens.some((token) => [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".rtf"].includes(token));
  const containsLegacy = tokens.some((token) => LEGACY_OR_UNINSPECTABLE.has(token));
  return containsOfficeOrPdf && containsLegacy;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function invalidFiles(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => !SAFE_EXTENSIONS.has(extensionOf(file.name)));
}

function findDocumentPicker(target: EventTarget | null): HTMLInputElement | null {
  if (target instanceof HTMLInputElement && isKnowledgeDocumentPicker(target)) return target;
  if (!(target instanceof Element)) return null;

  let current: Element | null = target;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const input = current.querySelector<HTMLInputElement>('input[type="file"]');
    if (input && isKnowledgeDocumentPicker(input)) return input;
  }
  return null;
}

function normalizeDocumentPickers(root: ParentNode = document) {
  root.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input) => {
    if (isKnowledgeDocumentPicker(input)) {
      input.setAttribute("accept", SAFE_ACCEPT);
      input.dataset.secureDocumentPicker = "true";
    }
  });
}

export function SecureUploadPolicyEnforcer() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    normalizeDocumentPickers();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) normalizeDocumentPickers(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const onChange = (event: Event) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (!input || input.dataset.secureDocumentPicker !== "true" || !input.files) return;
      const rejected = invalidFiles(input.files);
      if (rejected.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      input.value = "";
      setMessage(`${rejected.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, CSV, or TXT. Convert legacy DOC/XLS files before upload.`);
    };

    const onDrop = (event: DragEvent) => {
      const picker = findDocumentPicker(event.target);
      if (!picker || !event.dataTransfer?.files.length) return;
      const rejected = invalidFiles(event.dataTransfer.files);
      if (rejected.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      setMessage(`${rejected.map((file) => file.name).join(", ")}: unsupported format. Use PDF, DOCX, XLSX, CSV, or TXT. Convert legacy DOC/XLS files before upload.`);
    };

    document.addEventListener("change", onChange, true);
    document.addEventListener("drop", onDrop, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("change", onChange, true);
      document.removeEventListener("drop", onDrop, true);
    };
  }, []);

  if (!message) return null;
  return (
    <div role="alert" className="fixed bottom-4 right-4 z-[100] max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 shadow-lg">
      <div className="flex items-start gap-3">
        <span className="flex-1">{message}</span>
        <button type="button" onClick={() => setMessage("")} className="font-semibold text-red-700" aria-label="Dismiss upload error">×</button>
      </div>
    </div>
  );
}
