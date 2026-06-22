'use client'

import { useState, useEffect } from 'react'

const SUN  = 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z'
const MOON = 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z'

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    const saved = localStorage.getItem('fintrack-theme')
    setIsDark(saved !== 'light')
  }, [])

  function toggle() {
    const next = !isDark
    setIsDark(next)
    localStorage.setItem('fintrack-theme', next ? 'dark' : 'light')
    if (next) {
      document.documentElement.removeAttribute('data-theme')
    } else {
      document.documentElement.setAttribute('data-theme', 'light')
    }
  }

  return (
    <button
      onClick={toggle}
      className="w-9 h-9 flex items-center justify-center rounded-xl text-muted hover:text-ink hover:bg-white/[0.05] transition-colors flex-shrink-0"
      title={isDark ? 'Açık temaya geç' : 'Koyu temaya geç'}
    >
      <svg
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
        width={17}
        height={17}
        aria-hidden
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={isDark ? SUN : MOON} />
      </svg>
    </button>
  )
}
