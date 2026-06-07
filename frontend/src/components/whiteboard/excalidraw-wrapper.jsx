"use client";

import { useState, useEffect } from "react";

export default function ExcalidrawWrapper({
  initialData,
  readOnly,
  dark,
  onChange,
  onMount,
}) {
  const [ExcalidrawModule, setExcalidrawModule] = useState(null);

  useEffect(() => {
    import("@excalidraw/excalidraw").then((mod) => {
      setExcalidrawModule(mod);
    });
  }, []);

  if (!ExcalidrawModule) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/20 text-muted-foreground text-sm">
        Loading Whiteboard...
      </div>
    );
  }

  const { Excalidraw, MainMenu, exportToSvg } = ExcalidrawModule;

  return (
    <Excalidraw
      excalidrawAPI={(api) => {
        onMount(api, exportToSvg);
      }}
      initialData={initialData}
      viewModeEnabled={readOnly}
      onChange={onChange}
      aiEnabled={false}
      theme={dark ? "dark" : "light"}
      UIOptions={{
        canvasActions: {
          saveToActiveFile: false,
          loadScene: false,
          export: false,
        },
        tools: {
          image: false,
        },
      }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ClearCanvas />
        <MainMenu.DefaultItems.ToggleTheme />
        <MainMenu.DefaultItems.ChangeCanvasBackground />
      </MainMenu>
    </Excalidraw>
  );
}
