import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Provider, useDispatch, useSelector } from "react-redux";
import { configureStore, createAsyncThunk, createSelector, createSlice } from "@reduxjs/toolkit";
import { registerWebVitalsCollector } from "@benchmark/shared-ui/web-vitals";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const fetchItems = createAsyncThunk("items/fetchItems", async (_, { getState }) => {
  const state = getState().items;
  const query = new URLSearchParams({
    page: String(state.page),
    pageSize: "20",
    search: state.search,
    category: state.category,
    sortBy: state.sortBy
  });
  const response = await fetch(`${API_URL}/items?${query.toString()}`);
  return response.json();
});

const fetchHeavyItems = createAsyncThunk("items/fetchHeavyItems", async () => {
  const response = await fetch(`${API_URL}/items?page=1&pageSize=10000&sortBy=id`);
  return response.json();
});

const fetchItem = createAsyncThunk("items/fetchItem", async (id) => {
  const response = await fetch(`${API_URL}/items/${id}`);
  return response.json();
});

const saveItem = createAsyncThunk("items/saveItem", async (item) => {
  const response = await fetch(`${API_URL}/items/${item.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(item)
  });
  return response.json();
});

function calculateHeavySummary(items, search, sortBy, iteration) {
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

const itemsSlice = createSlice({
  name: "items",
  initialState: {
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
  },
  reducers: {
    setSearch: (state, action) => {
      state.search = action.payload;
      state.page = 1;
    },
    setCategory: (state, action) => {
      state.category = action.payload;
      state.page = 1;
    },
    setSort: (state, action) => {
      state.sortBy = action.payload;
    },
    setHeavySearch: (state, action) => {
      state.heavySearch = action.payload;
    },
    setHeavySort: (state, action) => {
      state.heavySortBy = action.payload;
    },
    runHeavyTick: (state, action) => {
      state.heavyRun = action.payload;
      state.heavySummary = calculateHeavySummary(
        state.allItems,
        state.heavySearch,
        state.heavySortBy,
        action.payload
      );
    },
    commitHeavyDerivedSummary: (state, action) => {
      state.derivedRun = action.payload.iteration;
      state.derivedSummary = action.payload.summary;
    },
    setSelectedTitle: (state, action) => {
      state.selected.title = action.payload;
    },
    clearSelected: (state) => {
      state.selected = null;
      state.savedItemId = null;
    }
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchItems.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchItems.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload.items;
        state.total = action.payload.total;
      })
      .addCase(fetchHeavyItems.pending, (state) => {
        state.heavyLoading = true;
      })
      .addCase(fetchHeavyItems.fulfilled, (state, action) => {
        state.heavyLoading = false;
        state.allItems = action.payload.items;
        state.heavySummary = null;
        state.derivedSummary = null;
      })
      .addCase(fetchItem.fulfilled, (state, action) => {
        state.selected = action.payload;
      })
      .addCase(saveItem.fulfilled, (state, action) => {
        state.selected = action.payload;
        state.savedItemId = action.payload.id;
      });
  }
});

const {
  clearSelected,
  commitHeavyDerivedSummary,
  runHeavyTick,
  setCategory,
  setHeavySearch,
  setHeavySort,
  setSearch,
  setSelectedTitle,
  setSort
} = itemsSlice.actions;
const store = configureStore({ reducer: { items: itemsSlice.reducer } });
const selectItemsState = (rootState) => rootState.items;
const selectVisibleItems = createSelector([selectItemsState], (state) => state.items);

function App() {
  const dispatch = useDispatch();
  const state = useSelector((rootState) => rootState.items);
  const visibleItems = useSelector(selectVisibleItems);

  useEffect(() => {
    registerWebVitalsCollector();
  }, []);

  useEffect(() => {
    dispatch(fetchItems());
  }, [dispatch, state.search, state.category, state.sortBy, state.page]);

  function runHeavyUpdates() {
    for (let iteration = 1; iteration <= 160; iteration += 1) {
      dispatch(runHeavyTick(iteration));
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
      dispatch(commitHeavyDerivedSummary({ iteration, summary }));
    }
  }

  if (state.selected) {
    return (
      <main className="page">
        <button data-testid="back-to-list" onClick={() => dispatch(clearSelected())}>
          Back to list
        </button>
        <h1>Record detail</h1>
        <label>
          Title
          <input
            data-testid="item-title-input"
            value={state.selected.title}
            onChange={(event) => dispatch(setSelectedTitle(event.target.value))}
          />
        </label>
        <p>Category: {state.selected.category}</p>
        <p>Score: {state.selected.score}</p>
        <button data-testid="save-item" onClick={() => dispatch(saveItem(state.selected))}>
          Save
        </button>
        {state.savedItemId === state.selected.id ? <span data-testid="save-complete">Saved</span> : null}
      </main>
    );
  }

  return (
    <main className="page">
      <h1>SPA Redux Benchmark</h1>
      <section className="toolbar">
        <input
          data-testid="search-input"
          placeholder="Search"
          value={state.search}
          onChange={(event) => dispatch(setSearch(event.target.value))}
        />
        <select
          data-testid="filter-category"
          value={state.category}
          onChange={(event) => dispatch(setCategory(event.target.value))}
        >
          <option value="">All categories</option>
          <option value="analytics">analytics</option>
          <option value="commerce">commerce</option>
          <option value="content">content</option>
          <option value="finance">finance</option>
          <option value="operations">operations</option>
        </select>
        <button data-testid="sort-score" onClick={() => dispatch(setSort("score"))}>
          Sort by score
        </button>
      </section>
      <section className="stress-panel">
        <h2>Heavy state workload</h2>
        <button data-testid="load-heavy-dataset" onClick={() => dispatch(fetchHeavyItems())}>
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
          onChange={(event) => dispatch(setHeavySearch(event.target.value))}
        />
        <button data-testid="heavy-sort-score" onClick={() => dispatch(setHeavySort("score"))}>
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
        {visibleItems.map((item) => (
          <button
            className="row"
            data-testid={`item-row-${item.id}`}
            key={item.id}
            onClick={() => dispatch(fetchItem(item.id))}
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

createRoot(document.getElementById("root")).render(
  <Provider store={store}>
    <App />
  </Provider>
);
