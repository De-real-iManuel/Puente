import { defineConfig } from "drizzle-kit";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  schema: join(__dirname, "./src/schema/index.ts"),
  out: join(__dirname, "./drizzle"),
  dialect: "postgresql",
  dbCredentials: {
    url: "postgresql://placeholder/placeholder",
  },
});
