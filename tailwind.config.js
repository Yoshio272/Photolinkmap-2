/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1565C0',
          light: '#E3EDFB',
          dark: '#0D47A1',
        },
        success: {
          DEFAULT: '#1D9E75',
          light: '#E0F5EC',
          dark: '#0F6E56',
        },
      }
    }
  },
  plugins: [],
}
