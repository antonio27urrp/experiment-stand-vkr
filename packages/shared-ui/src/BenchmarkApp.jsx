import React, { useEffect, useMemo, useReducer } from "react";
import { registerWebVitalsCollector } from "./webVitalsCollector.js";

/** Fallback for local/dev; production pages should pass `apiUrl`. */
const defaultApiUrl = "http://localhost:4000";

const initialState = {
  items: [],
  allItems: [],
  total: 0,
  page: 1,
  search: "",
  category: "",
  sortBy: "id",
  selected: null,
  savedItemId: null,
  loading: false,
  heavyLoading: false,
  heavySearch: "",
  heavySortBy: "id",
  heavyRun: 0,
  heavySummary: null,
  derivedRun: 0,
  derivedSummary: null
};

export function calculateHeavySummary(items, search, sortBy, iteration) {
  const normalizedSearch = search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    return (
      !normalizedSearch ||
      item.title.toLowerCase().includes(normalizedSearch) ||
      item.description.toLowerCase().includes(normalizedSearch)
    );
  });
  const sorted = [...filtered].sort((a, b) => {
    if (a[sortBy] < b[sortBy]) return -1;
    if (a[sortBy] > b[sortBy]) return 1;
    return 0;
  });

  let checksum = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    for (const item of sorted) {
      checksum += Math.sqrt(item.score * (iteration + 1) + pass) % 17;
    }
  }

  return {
    count: sorted.length,
    averageScore: sorted.length
      ? sorted.reduce((sum, item) => sum + item.score, 0) / sorted.length
      : 0,
    checksum: Math.round(checksum),
    iteration
  };
}

function reducer(state, action) {
  switch (action.type) {
    case "LOAD_START":
      return { ...state, loading: true };
    case "LOAD_SUCCESS":
      return { ...state, loading: false, items: action.payload.items, total: action.payload.total };
    case "HYDRATE_INITIAL":
      return { ...state, items: action.payload.items, total: action.payload.total };
    case "HEAVY_LOAD_START":
      return { ...state, heavyLoading: true };
    case "HEAVY_LOAD_SUCCESS":
      return {
        ...state,
        heavyLoading: false,
        allItems: action.payload.items,
        heavySummary: null,
        derivedSummary: null
      };
    case "SET_SEARCH":
      return { ...state, search: action.payload, page: 1 };
    case "SET_CATEGORY":
      return { ...state, category: action.payload, page: 1 };
    case "SET_SORT":
      return { ...state, sortBy: action.payload };
    case "SET_HEAVY_SEARCH":
      return { ...state, heavySearch: action.payload };
    case "SET_HEAVY_SORT":
      return { ...state, heavySortBy: action.payload };
    case "HEAVY_TICK":
      return {
        ...state,
        heavyRun: action.payload,
        heavySummary: calculateHeavySummary(
          state.allItems,
          state.heavySearch,
          state.heavySortBy,
          action.payload
        )
      };
    case "HEAVY_DERIVED_COMMIT":
      return {
        ...state,
        derivedRun: action.payload.iteration,
        derivedSummary: action.payload.summary
      };
    case "SELECT_ITEM":
      return { ...state, selected: action.payload };
    case "SAVE_SUCCESS":
      return { ...state, selected: action.payload, savedItemId: action.payload.id };
    case "CLEAR_SELECTED":
      return { ...state, selected: null, savedItemId: null };
    default:
      return state;
  }
}

function buildQuery(state) {
  return new URLSearchParams({
    page: String(state.page),
    pageSize: "20",
    search: state.search,
    category: state.category,
    sortBy: state.sortBy
  });
}

export function BenchmarkApp({ title, apiUrl = defaultApiUrl, initialItems = null, schema = null }) {
  const [state, dispatch] = useReducer(reducer, {
    ...initialState,
    items: initialItems?.items ?? [],
    total: initialItems?.total ?? 0
  });
  const query = useMemo(() => buildQuery(state), [state.page, state.search, state.category, state.sortBy]);

  useEffect(() => {
    registerWebVitalsCollector();
  }, []);

  useEffect(() => {
    if (initialItems && !state.search && !state.category && state.sortBy === "id") {
      dispatch({ type: "HYDRATE_INITIAL", payload: initialItems });
      return;
    }

    const controller = new AbortController();
    dispatch({ type: "LOAD_START" });
    fetch(`${apiUrl}/items?${query.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => dispatch({ type: "LOAD_SUCCESS", payload }))
      .catch((error) => {
        if (error.name !== "AbortError") console.error(error);
      });

    return () => controller.abort();
  }, [apiUrl, initialItems, query, state.category, state.search, state.sortBy]);

  async function openDetail(id) {
    const response = await fetch(`${apiUrl}/items/${id}`);
    dispatch({ type: "SELECT_ITEM", payload: await response.json() });
  }

  async function saveSelected() {
    const response = await fetch(`${apiUrl}/items/${state.selected.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state.selected)
    });
    dispatch({ type: "SAVE_SUCCESS", payload: await response.json() });
  }

  async function loadHeavyDataset() {
    dispatch({ type: "HEAVY_LOAD_START" });
    const response = await fetch(`${apiUrl}/items?page=1&pageSize=10000&sortBy=id`);
    dispatch({ type: "HEAVY_LOAD_SUCCESS", payload: await response.json() });
  }

  function runHeavyUpdates() {
    for (let iteration = 1; iteration <= 160; iteration += 1) {
      dispatch({ type: "HEAVY_TICK", payload: iteration });
    }
  }

  function runHeavyDerivedUpdates() {
    for (let iteration = 1; iteration <= 160; iteration += 1) {
      const summary = calculateHeavySummary(
        state.allItems,
        state.heavySearch,
        state.heavySortBy,
        iteration
      );
      dispatch({ type: "HEAVY_DERIVED_COMMIT", payload: { iteration, summary } });
    }
  }

  if (state.selected) {
    return (
      <main className="page">
        <button data-testid="back-to-list" onClick={() => dispatch({ type: "CLEAR_SELECTED" })}>
          Back to list
        </button>
        <h1>{title} detail</h1>
        <label>
          Title
          <input
            data-testid="item-title-input"
            value={state.selected.title}
            onChange={(event) =>
              dispatch({ type: "SELECT_ITEM", payload: { ...state.selected, title: event.target.value } })
            }
          />
        </label>
        <p>Category: {state.selected.category}</p>
        <p>Score: {state.selected.score}</p>
        <button data-testid="save-item" onClick={saveSelected}>
          Save
        </button>
        {state.savedItemId === state.selected.id ? <span data-testid="save-complete">Saved</span> : null}
      </main>
    );
  }

  return (
    <main className="page">
      <h1>{title}</h1>
      {schema ? <p className="schema-note">UI schema version: {schema.version}</p> : null}
      <section className="toolbar">
        <input
          data-testid="search-input"
          placeholder="Search"
          value={state.search}
          onChange={(event) => dispatch({ type: "SET_SEARCH", payload: event.target.value })}
        />
        <select
          data-testid="filter-category"
          value={state.category}
          onChange={(event) => dispatch({ type: "SET_CATEGORY", payload: event.target.value })}
        >
          <option value="">All categories</option>
          <option value="analytics">analytics</option>
          <option value="commerce">commerce</option>
          <option value="content">content</option>
          <option value="finance">finance</option>
          <option value="operations">operations</option>
        </select>
        <button data-testid="sort-score" onClick={() => dispatch({ type: "SET_SORT", payload: "score" })}>
          Sort by score
        </button>
      </section>
      <section className="stress-panel">
        <h2>Heavy state workload</h2>
        <button data-testid="load-heavy-dataset" onClick={loadHeavyDataset}>
          Load heavy dataset
        </button>
        {state.allItems.length > 0 ? (
          <span data-testid="heavy-dataset-ready">Loaded: {state.allItems.length}</span>
        ) : null}
        {state.heavyLoading ? <span>Loading heavy dataset...</span> : null}
        <input
          data-testid="heavy-search-input"
          placeholder="Heavy search"
          value={state.heavySearch}
          onChange={(event) => dispatch({ type: "SET_HEAVY_SEARCH", payload: event.target.value })}
        />
        <button data-testid="heavy-sort-score" onClick={() => dispatch({ type: "SET_HEAVY_SORT", payload: "score" })}>
          Heavy sort by score
        </button>
        <button data-testid="run-heavy-updates" onClick={runHeavyUpdates}>
          Run reducer updates
        </button>
        <button data-testid="run-heavy-derived-updates" onClick={runHeavyDerivedUpdates}>
          Run derived updates
        </button>
        {state.heavySummary ? (
          <output data-testid="heavy-complete">
            Run {state.heavyRun}: {state.heavySummary.count} records, checksum {state.heavySummary.checksum}
          </output>
        ) : null}
        {state.derivedSummary ? (
          <output data-testid="heavy-derived-complete">
            Derived run {state.derivedRun}: {state.derivedSummary.count} records, checksum{" "}
            {state.derivedSummary.checksum}
          </output>
        ) : null}
      </section>
      <section data-testid="items-list" className="list">
        {state.loading ? <p>Loading...</p> : null}
        {state.items.map((item) => (
          <button
            className="row"
            data-testid={`item-row-${item.id}`}
            key={item.id}
            onClick={() => openDetail(item.id)}
          >
            <span>{item.title}</span>
            <span>{item.category}</span>
            <span>{item.score}</span>
          </button>
        ))}
      </section>
      <p>Total: {state.total}</p>
    </main>
  );
}
