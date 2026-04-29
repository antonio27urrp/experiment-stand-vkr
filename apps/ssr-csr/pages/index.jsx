import { BenchmarkApp } from "@benchmark/shared-ui";

const publicApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const internalApiUrl = process.env.INTERNAL_API_URL ?? publicApiUrl;

export async function getServerSideProps() {
  try {
    const response = await fetch(`${internalApiUrl}/items?page=1&pageSize=20&sortBy=id`);
    const initialItems = await response.json();

    return {
      props: {
        initialItems
      }
    };
  } catch (_error) {
    return {
      props: {
        initialItems: { items: [], total: 0 }
      }
    };
  }
}

export default function SsrCsrPage({ initialItems }) {
  return <BenchmarkApp title="SSR + CSR Benchmark" apiUrl={publicApiUrl} initialItems={initialItems} />;
}
