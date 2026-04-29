import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BenchmarkApp } from "@benchmark/shared-ui";
import "@benchmark/shared-ui/styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function ServerDrivenApp() {
  const [schema, setSchema] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/ui-schema`)
      .then((response) => response.json())
      .then(setSchema)
      .catch((fetchError) => setError(fetchError.message));
  }, []);

  if (error) {
    return <main className="page">Failed to load UI schema: {error}</main>;
  }

  if (!schema) {
    return <main className="page">Loading server-driven schema...</main>;
  }

  return <BenchmarkApp title="Server-Driven UI Benchmark" apiUrl={API_URL} schema={schema} />;
}

createRoot(document.getElementById("root")).render(<ServerDrivenApp />);
