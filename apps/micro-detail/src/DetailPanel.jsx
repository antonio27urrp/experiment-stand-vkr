import React from "react";

export default function DetailPanel({ item }) {
  if (!item) {
    return null;
  }

  return (
    <section className="stress-panel">
      <h2>Remote detail module</h2>
      <p>Category: {item.category}</p>
      <p>Score: {item.score}</p>
      <p>Owner: {item.owner}</p>
    </section>
  );
}
