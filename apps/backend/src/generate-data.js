const categories = ["analytics", "commerce", "content", "finance", "operations"];
const statuses = ["draft", "active", "archived"];

function seededRandom(seed) {
  let value = seed % 2147483647;

  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function pick(items, random) {
  return items[Math.floor(random() * items.length)];
}

export function generateItems(size, seed = 42) {
  const random = seededRandom(seed + size);
  const baseDate = Date.UTC(2025, 0, 1);

  return Array.from({ length: size }, (_, index) => {
    const id = index + 1;
    const category = pick(categories, random);
    const score = Math.round(random() * 1000) / 10;
    const createdAt = new Date(baseDate + id * 86400000).toISOString();

    return {
      id,
      title: `Record ${id}`,
      category: id === 2 ? "analytics" : category,
      status: id === 2 ? "active" : pick(statuses, random),
      score,
      owner: `user-${Math.ceil(random() * 25)}`,
      createdAt,
      updatedAt: createdAt,
      description: `Synthetic benchmark record ${id} in ${category} category with score ${score}.`,
      tags: [`tag-${id % 7}`, `segment-${id % 5}`]
    };
  });
}
