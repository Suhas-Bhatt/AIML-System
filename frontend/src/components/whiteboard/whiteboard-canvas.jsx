"use client";

import {
  useCallback,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useRef,
} from "react";
import dynamic from "next/dynamic";

import "./whiteboard-overrides.css";

// Dynamically load the wrapper with ssr: false to prevent Next.js from
// bundling Excalidraw on the server (which causes the ReactCurrentDispatcher error).
const ExcalidrawWrapper = dynamic(() => import("./excalidraw-wrapper"), {
  ssr: false,
});

export const WhiteboardCanvas = forwardRef(
  function WhiteboardCanvas(
    {
      readOnly = false,
      initialData,
      onAutoSave,
      autoSaveInterval = 3000,
      fillParent = false,
      onDirty,
      dark = false,
    },
    ref,
  ) {
    const apiRef = useRef(null);
    const exportToSvgRef = useRef(null);

    const autoSaveTimer = useRef(null);
    const onAutoSaveRef = useRef(onAutoSave);
    onAutoSaveRef.current = onAutoSave;
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;

    // ── Parse initial data ────────────────────────────────────────
    const parsedInitial = useRef(null);
    if (initialData && !parsedInitial.current) {
      try {
        const raw = JSON.parse(initialData);
        // Strip collaborators — serialised as plain object but Excalidraw needs a Map
        if (raw?.appState) {
          const { collaborators: _c, ...safeAppState } = raw.appState;
          raw.appState = safeAppState;
        }
        parsedInitial.current = raw;
      } catch {
        // ignore bad data
      }
    }

    // ── Auto-save on scene changes ────────────────────────────────
    // Track element versions so we only fire onDirty for real content changes
    // (Excalidraw's onChange fires for selections, cursor moves, etc.)
    const lastElementsSnapshot = useRef("");

    const handleChange = useCallback(() => {
      if (readOnly || !apiRef.current) return;

      const elements = apiRef.current.getSceneElements();
      const snapshot = JSON.stringify(elements);

      // Only notify dirty and schedule auto-save when elements actually change
      if (snapshot === lastElementsSnapshot.current) return;
      lastElementsSnapshot.current = snapshot;

      onDirtyRef.current?.();

      if (!onAutoSaveRef.current) return;
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(() => {
        if (!onAutoSaveRef.current || !apiRef.current) return;
        if (elements.length === 0) return;

        const data = JSON.stringify({
          elements,
          appState: apiRef.current.getAppState(),
        });
        onAutoSaveRef.current(data);
      }, autoSaveInterval);
    }, [readOnly, autoSaveInterval]);

    // Cleanup timer on unmount
    useEffect(() => {
      return () => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      };
    }, []);

    // ── Imperative ref for parent components ──────────────────────
    useImperativeHandle(
      ref,
      () => ({
        hasContent() {
          if (!apiRef.current) return false;
          return apiRef.current.getSceneElements().length > 0;
        },

        getSnapshotData() {
          if (!apiRef.current) return null;
          const elements = apiRef.current.getSceneElements();
          if (elements.length === 0) return null;
          return JSON.stringify({
            elements,
            appState: apiRef.current.getAppState(),
          });
        },

        async getImageDataUrl() {
          if (!apiRef.current || !exportToSvgRef.current) return null;
          const elements = apiRef.current.getSceneElements();
          if (elements.length === 0) return null;

          try {
            const svg = await exportToSvgRef.current({
              elements,
              appState: {
                exportBackground: true,
                viewBackgroundColor: apiRef.current.getAppState().viewBackgroundColor,
              },
              exportPadding: 10,
              files: apiRef.current.getFiles(),
            });
            const svgString = new XMLSerializer().serializeToString(svg);
            return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
          } catch {
            return null;
          }
        },

        async exportImageFromData(snapshotData) {
          if (!exportToSvgRef.current) return null;
          try {
            const parsed = JSON.parse(snapshotData);
            const elements = parsed.elements ?? [];
            if (elements.length === 0) return null;
            const svg = await exportToSvgRef.current({
              elements,
              appState: { exportBackground: true },
              exportPadding: 10,
              files: {},
            });
            const svgString = new XMLSerializer().serializeToString(svg);
            return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgString)))}`;
          } catch {
            return null;
          }
        },

        resetScene() {
          apiRef.current?.resetScene();
        },

        loadScene(data) {
          if (!apiRef.current) return;
          try {
            const parsed = JSON.parse(data);
            // Strip collaborators — it's a Map internally but gets
            // serialised as a plain object, which Excalidraw can't iterate.
            const { collaborators: _c, ...safeAppState } = (parsed.appState ?? {});
            apiRef.current.updateScene({
              elements: parsed.elements ?? [],
              appState: safeAppState,
            });
          } catch {
            // ignore bad data
          }
        },
      }),
      [],
    );

    // ── Render ────────────────────────────────────────────────────
    return (
      <div
        className={
          fillParent
            ? "h-full w-full overflow-hidden"
            : "h-[400px] w-full rounded-lg border overflow-hidden"
        }
      >
        <ExcalidrawWrapper
          onMount={(api, exportFn) => {
            apiRef.current = api;
            exportToSvgRef.current = exportFn;
          }}
          initialData={parsedInitial.current ?? undefined}
          readOnly={readOnly}
          dark={dark}
          onChange={handleChange}
        />
      </div>
    );
  },
);
