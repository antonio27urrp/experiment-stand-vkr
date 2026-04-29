import { BenchmarkApp } from "@benchmark/shared-ui";

function resolveApiUrls() {
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const internalApiUrl = process.env.INTERNAL_API_URL ?? publicApiUrl;
  return { publicApiUrl, internalApiUrl };
}

export async function getServerSideProps() {
  const { publicApiUrl, internalApiUrl } = resolveApiUrls();

  try {
    const response = await fetch(`${internalApiUrl}/items?page=1&pageSize=20&sortBy=id`);
    const initialItems = await response.json();

    return {
      props: {
        initialItems,
        apiUrl: publicApiUrl
      }
    };
  } catch (_error) {
    return {
      props: {
        initialItems: { items: [], total: 0 },
        apiUrl: publicApiUrl
      }
    };
  }
}

export default function SsrCsrPage({ initialItems, apiUrl }) {
  return (
    <BenchmarkApp title="SSR + CSR Benchmark" apiUrl={apiUrl} initialItems={initialItems} />
  );
}
