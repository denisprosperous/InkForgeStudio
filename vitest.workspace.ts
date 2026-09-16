import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "config",
      environment: "node",
      include: ["packages/config/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "db",
      environment: "node",
      include: ["packages/db/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "ai",
      environment: "node",
      include: ["packages/ai/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "core",
      environment: "node",
      include: ["packages/core/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "covers",
      environment: "node",
      include: ["packages/covers/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "ui",
      environment: "node",
      include: ["packages/ui/test/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "forge",
      environment: "node",
      include: ["apps/forge/test/**/*.test.ts"],
      testTimeout: 20_000,
    },
  },
  {
    test: {
      name: "web",
      environment: "node",
      include: ["apps/web/test/**/*.test.ts"],
    },
  },
]);
