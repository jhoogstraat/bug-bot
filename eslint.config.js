import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const formatting = {
  rules: {
    "blank-line-after-multiline-closing": {
      meta: {
        type: "layout",
        fixable: "whitespace",
        schema: [],
        messages: {
          missingBlankLine: "Expected one empty line after this multiline statement.",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;

        function checkStatementList(statements) {
          for (let index = 0; index < statements.length - 1; index += 1) {
            const statement = statements[index];
            const nextStatement = statements[index + 1];
            const lastToken = sourceCode.getLastToken(statement);

            if (
              statement.type === "ImportDeclaration" ||
              statement.loc.start.line === statement.loc.end.line ||
              !["}", "]", ";"].includes(lastToken.value) ||
              nextStatement.loc.start.line - lastToken.loc.end.line >= 2
            ) {
              continue;
            }

            context.report({
              node: nextStatement,
              messageId: "missingBlankLine",
              fix: (fixer) => fixer.insertTextAfter(lastToken, "\n"),
            });
          }
        }

        return {
          Program: (node) => checkStatementList(node.body),
          BlockStatement: (node) => checkStatementList(node.body),
        };
      },
    },
  },
};

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "eslint.config.js"] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    plugins: { formatting },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-control-regex": "off",
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "formatting/blank-line-after-multiline-closing": "error",
      "no-multiple-empty-lines": ["error", { max: 1, maxBOF: 0, maxEOF: 0 }],
    },
  },
);
