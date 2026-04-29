import React, { useEffect, useState } from "react";

export default function CrudPanel({ item, onBack, onSave, savedItemId = null }) {
  const [draft, setDraft] = useState(item);

  useEffect(() => {
    setDraft(item);
  }, [item]);

  if (!draft) {
    return null;
  }

  return (
    <section>
      <button data-testid="back-to-list" onClick={onBack}>
        Back to list
      </button>
      <h1>Micro Frontends detail</h1>
      <label>
        Title
        <input
          data-testid="item-title-input"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </label>
      <button
        data-testid="save-item"
        onClick={() => onSave?.(draft)}
      >
        Save
      </button>
      {savedItemId === draft.id ? <span data-testid="save-complete">Saved</span> : null}
    </section>
  );
}
