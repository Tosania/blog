/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");
module.exports = {
	content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,mjs}"],
	darkMode: "class", // allows toggling dark mode manually
	theme: {
		extend: {
			fontFamily: {
				sans: ["Roboto", "sans-serif", ...defaultTheme.fontFamily.sans],
				kai: [
					'"STKaiti"', // macOS 华文楷体
					'"Kaiti SC"', // macOS 楷体（部分环境）
					'"KaiTi"', // Windows 楷体
					'"KaiTi_GB2312"', // Windows 旧版
					'"DFKai-SB"', // 繁体环境常见
					"serif",
				],
			},
		},
	},
	plugins: [require("@tailwindcss/typography")],
};
