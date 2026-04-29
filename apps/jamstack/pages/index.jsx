import { BenchmarkApp } from "@benchmark/shared-ui";

function resolveApiUrls() {
  const publicApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
  const internalApiUrl = process.env.INTERNAL_API_URL ?? publicApiUrl;
  return { publicApiUrl, internalApiUrl };
}

export async function getStaticProps() {
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
  } catch (error) {
    console.error("API error:", error);

    return {
      props: {
        initialItems: { items: [], total: 0 },
        apiUrl: publicApiUrl
      }
    };
  }
}

export default function JamstackPage({ initialItems, apiUrl }) {
  return (
    <BenchmarkApp title="Jamstack Benchmark" apiUrl={apiUrl} initialItems={initialItems} />
  );
}
