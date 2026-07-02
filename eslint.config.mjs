// Local mirror of the Obsidian community plugin review bot's lint setup.
// Reproduces the bot's findings before pushing (see review-bot skill).
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
	{
		ignores: [
			'main.js',
			'node_modules/**',
			'_devprocess/**',
			'*.mjs',
			'vitest.config.ts',
			'src/**/__tests__/**',
		],
	},
	...obsidianmd.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			'@typescript-eslint/no-deprecated': 'warn',
			'@typescript-eslint/prefer-promise-reject-errors': 'warn',
			'@typescript-eslint/no-floating-promises': 'warn',
			'@typescript-eslint/no-misused-promises': 'warn',
			'@typescript-eslint/no-unused-vars': 'warn',
		},
	},
);
