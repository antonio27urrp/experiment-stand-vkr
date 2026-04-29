export function getUiSchema() {
  return {
    version: 1,
    page: {
      type: "layout",
      props: {
        title: "Frontend Architecture Benchmark"
      },
      children: [
        {
          type: "toolbar",
          props: {
            searchPlaceholder: "Search records",
            filters: ["category", "status"],
            sortFields: ["id", "title", "category", "score", "createdAt"]
          }
        },
        {
          type: "dataTable",
          props: {
            source: "/items",
            columns: ["id", "title", "category", "status", "score", "owner", "createdAt"],
            detailRoute: "/items/:id"
          }
        },
        {
          type: "pagination",
          props: {
            pageSizeOptions: [20, 50, 100]
          }
        }
      ]
    }
  };
}
