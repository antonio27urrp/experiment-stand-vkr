import React, { useEffect, useMemo, useState } from "react";
import "@benchmark/shared-ui/styles.css";

const defaultApiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

function buildQuery({ search, category, sortBy }) {
  return new URLSearchParams({
    page: "1",
    pageSize: "20",
    search,
    category,
    sortBy
  });
}

export default function ListApp({
  apiUrl = defaultApiUrl,
  onOpenDetail,
  title = "Micro Frontends Benchmark"
}) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [sortBy, setSortBy] = useState("id");
  const query = useMemo(() => buildQuery({ search, category, sortBy }), [category, search, sortBy]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/items?${query.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        setItems(payload.items);
        setTotal(payload.total);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      });

    return () => controller.abort();
  }, [apiUrl, query]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.__benchmarkMicroFrontend ??= {
      modules: {},
      firstModuleMs: null,
      compositionReadyMs: null
    };

    if (window.__benchmarkMicroFrontend.compositionReadyMs === null) {
      window.__benchmarkMicroFrontend.compositionReadyMs = performance.now();
    }
  }, []);

  return (
    <main className="page">
      <h1>{title}</h1>
      <section className="toolbar">
        <input
          data-testid="search-input"
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          data-testid="filter-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">All categories</option>
          <option value="analytics">analytics</option>
          <option value="commerce">commerce</option>
          <option value="content">content</option>
          <option value="finance">finance</option>
          <option value="operations">operations</option>
        </select>
        <button data-testid="sort-score" onClick={() => setSortBy("score")}>
          Sort by score
        </button>
      </section>
      <p>Total records: {total}</p>
      <section data-testid="items-list" className="items-list">
        {items.map((item) => (
          <button
            key={item.id}
            data-testid={`item-row-${item.id}`}
            className="item-row"
            onClick={() => onOpenDetail?.(item.id)}
          >
            <strong>{item.title}</strong>
            <span>{item.category}</span>
            <span>{item.score}</span>
          </button>
        ))}
      </section>
    </main>
  );
}
