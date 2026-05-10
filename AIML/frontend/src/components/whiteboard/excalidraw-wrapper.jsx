"use client";

import { Excalidraw, MainMenu, exportToSvg } from "@excalidraw/excalidraw";

export default function ExcalidrawWrapper({
  initialData,
  readOnly,
  dark,
  onChange,
  onMount,
}) {
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
