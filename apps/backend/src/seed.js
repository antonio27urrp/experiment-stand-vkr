import { writeDataset } from "./storage.js";

function parseSize(argv) {
  const sizeArg = argv.find((arg) => arg.startsWith("--size="));

  if (sizeArg) {
    return Number(sizeArg.split("=")[1]);
  }

  const index = argv.indexOf("--size");
  if (index !== -1) {
    return Number(argv[index + 1]);
  }

  return 100;
}

const size = parseSize(process.argv.slice(2));

if (![100, 1000, 10000].includes(size)) {
  console.error("Dataset size must be one of: 100, 1000, 10000");
  process.exit(1);
}

const items = await writeDataset(size);
console.log(`Generated ${items.length} records`);
