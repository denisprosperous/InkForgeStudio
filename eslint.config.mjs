// @ts-check
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import nextPlugin from "@next/eslint-plugin-next";

/**
 * Custom architectural guard (Master Directive §6.3):
 * Every drizzle query that touches a user-scoped table must reference `userId`
 * inside the same statement, making cross-tenant reads impossible by construction.
 * Legitimately unscoped system queries (e.g. the worker reclaim query) must carry
 * an explicit `// eslint-disable-next-line inkforge/no-unscoped-user-query` line
 * with a justification comment directly above.
 */
const USER_SCOPED = new RegExp(
  [
    "\\bbooks\\b",
    "\\bchapters\\b",
    "\\boutlines\\b",
    "\\bassets\\b",
    "\\bcovers\\b",
    "\\bcoverVersions\\b",
    "\\bcover_versions\\b",
    "\\bjobs\\b",
    "\\bexports\\b",
    "\\buserApiKeys\\b",
    "\\buser_api_keys\\b",
    "\\bhumanizeRuns\\b",
    "\\bhumanize_runs\\b",
    "\\bauditLog\\b",
    "\\baudit_log\\b",
  ].join("|"),
  "u",
);

const noUnscopedUserQuery = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a userId scope on every drizzle select/update/delete against user-owned tables.",
      recommended: false,
    },
    messages: {
      unscoped:
        "DB query on a user-scoped table lacks a userId scope. Every read/write of user-owned data must filter with eq(table.userId, userId). If the query is genuinely system-scoped (worker/queue internals), justify it in a comment and add `// eslint-disable-next-line inkforge/no-unscoped-user-query`.",
    },
    schema: [],
  },
  create(context) {
    const TERMINALS = new Set([
      "ExpressionStatement",
      "VariableDeclarator",
      "ReturnStatement",
      "ArrowFunctionExpression",
      "AwaitExpression",
      "Property",
    ]);
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== "MemberExpression" ||
          callee.property.type !== "Identifier" ||
          callee.object.type !== "Identifier"
        ) {
          return;
        }
        if (!["select", "update", "delete"].includes(callee.property.name)) {
          return;
        }
        if (!/^(db|tx)$/.test(callee.object.name)) {
          return;
        }
        let anc = node.parent;
        while (anc && !TERMINALS.has(anc.type)) {
          anc = anc.parent;
        }
        const target = anc ?? node;
        const text = context.sourceCode.getText(target);
        if (!USER_SCOPED.test(text)) {
          return;
        }
        if (/userId/.test(text)) {
          return;
        }
        context.report({ node, messageId: "unscoped" });
      },
    };
  },
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.vercel/**",
      "**/.wrangler/**",
      "**/.next-on-pages/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
      "apps/web/public/fonts/**",
      "scripts/selfhost.sh",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/*.js"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2023,
        sourceType: "module",
      },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Response: "readonly",
        Request: "readonly",
        FormData: "readonly",
        AbortSignal: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": nextPlugin,
      inkforge: { rules: { "no-unscoped-user-query": noUnscopedUserQuery } },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "object-shorthand": ["warn", "always"],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "inkforge/no-unscoped-user-query": "error",
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "e2e/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
