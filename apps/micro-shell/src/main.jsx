import React, { Suspense, lazy, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { registerWebVitalsCollector } from "@benchmark/shared-ui/web-vitals";
import "@benchmark/shared-ui/styles.css";

function loadRemoteWithMetrics(remoteName, loader) {
  return loader().then((module) => {
    if (typeof window !== "undefined") {
      window.__benchmarkMicroFrontend ??= {
        modules: {},
        firstModuleMs: null,
        compositionReadyMs: null
      };
      const now = performance.now();
      window.__benchmarkMicroFrontend.modules[remoteName] = now;
      if (window.__benchmarkMicroFrontend.firstModuleMs === null) {
        window.__benchmarkMicroFrontend.firstModuleMs = now;
      }
    }

    return module;
  });
}

const RemoteListApp = lazy(() => loadRemoteWithMetrics("microList", () => import("microList/ListApp")));
const RemoteDetailPanel = lazy(() => loadRemoteWithMetrics("microDetail", () => import("microDetail/DetailPanel")));
const RemoteCrudPanel = lazy(() => loadRemoteWithMetrics("microCrud", () => import("microCrud/CrudPanel")));
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function App() {
  const [selected, setSelected] = useState(null);
  const [savedItemId, setSavedItemId] = useState(null);

  useEffect(() => {
    registerWebVitalsCollector();
    window.__benchmarkMicroFrontend ??= {
      modules: {},
      firstModuleMs: null,
      compositionReadyMs: null
    };
  }, []);

  async function openDetail(id) {
    const response = await fetch(`${API_URL}/items/${id}`);
    setSavedItemId(null);
    setSelected(await response.json());
  }

  async function saveSelected(item) {
    const response = await fetch(`${API_URL}/items/${item.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(item)
    });
    const saved = await response.json();
    setSelected(saved);
    setSavedItemId(saved.id);
  }

  if (selected) {
    return (
      <main className="page">
        <Suspense fallback={<p>Loading remote detail...</p>}>
          <RemoteDetailPanel item={selected} />
          <RemoteCrudPanel
            item={selected}
            onBack={() => {
              setSavedItemId(null);
              setSelected(null);
            }}
            onSave={saveSelected}
            savedItemId={savedItemId}
          />
        </Suspense>
      </main>
    );
  }

  return (
    <Suspense fallback={<main className="page">Loading micro frontend...</main>}>
      <RemoteListApp apiUrl={API_URL} onOpenDetail={openDetail} title="Micro Frontends Benchmark" />
    </Suspense>
  );
}

createRoot(document.getElementById("root")).render(<App />);
