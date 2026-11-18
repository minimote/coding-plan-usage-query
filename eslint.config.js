import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "tmp/", ".history/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // 测试里需要匹配 ANSI 转义码（\x1b[...m），控制字符是必需的
    files: ["test/**"],
    rules: {"no-control-regex": "off"},
  },
  {
    // 解构丢弃的字段统一用 _ 前缀占位
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
