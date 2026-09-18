import { readFileSync } from "node:fs";

const raw = readFileSync(new URL("../config.json", import.meta.url), "utf8");
const config = JSON.parse(raw);

export default config;