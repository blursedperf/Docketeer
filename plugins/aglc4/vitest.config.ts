import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Tests run outside the app: they use a stand-in for the parts of @quire/api they touch.
		alias: { "@quire/api": fileURLToPath(new URL("./test/quire-stub.ts", import.meta.url)) },
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
});
