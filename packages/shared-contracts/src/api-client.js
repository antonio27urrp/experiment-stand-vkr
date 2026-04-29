export function createApiClient(baseUrl = "http://localhost:4000") {
  async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        "content-type": "application/json",
        ...options.headers
      },
      ...options
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`API ${response.status}: ${message}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  return {
    health: () => request("/health"),
    seed: (size) => request(`/seed?size=${size}`, { method: "POST" }),
    listItems: (params = {}) => {
      const searchParams = new URLSearchParams(params);
      return request(`/items?${searchParams.toString()}`);
    },
    getItem: (id) => request(`/items/${id}`),
    createItem: (item) => request("/items", { method: "POST", body: JSON.stringify(item) }),
    updateItem: (id, item) => request(`/items/${id}`, { method: "PUT", body: JSON.stringify(item) }),
    deleteItem: (id) => request(`/items/${id}`, { method: "DELETE" }),
    getUiSchema: () => request("/ui-schema")
  };
}
