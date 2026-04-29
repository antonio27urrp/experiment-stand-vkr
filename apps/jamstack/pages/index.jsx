import { BenchmarkApp } from "@benchmark/shared-ui";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function getStaticProps() {
  const response = await fetch(`${apiUrl}/items?page=1&pageSize=20&sortBy=id`);
  const initialItems = await response.json();

  return {
    props: {
      initialItems
    }
  };
}

export default function JamstackPage({ initialItems }) {
  return <BenchmarkApp title="Jamstack Benchmark" apiUrl={apiUrl} initialItems={initialItems} />;
}
