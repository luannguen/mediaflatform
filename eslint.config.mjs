import parser from '@typescript-eslint/parser';
export default [{ ignores: ['.next/**','node_modules/**','packages/sdk/dist/**','scratch/**'] }, {
 files: ['**/*.{ts,tsx,js}'],
 languageOptions: { parser, ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
 rules: { 'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-dupe-else-if': 'error', 'no-unsafe-finally': 'error', 'use-isnan': 'error', 'valid-typeof': 'error', 'constructor-super': 'error', 'no-async-promise-executor': 'error' },
}];
