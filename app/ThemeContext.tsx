'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
    theme: Theme;
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'xmtp-mx-theme';

function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function getStoredTheme(): Theme {
    if (typeof window === 'undefined') return 'system';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
            return stored;
        }
    } catch {
        // localStorage not available
    }
    return 'system';
}

function applyTheme(resolvedTheme: ResolvedTheme) {
    const root = document.documentElement;

    // Add transitioning class briefly to prevent flash
    root.classList.add('theme-transitioning');

    if (resolvedTheme === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }

    // Remove transitioning class after a frame
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            root.classList.remove('theme-transitioning');
        });
    });
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');
    const [mounted, setMounted] = useState(false);

    // Initialize theme from localStorage on mount
    useEffect(() => {
        const storedTheme = getStoredTheme();
        setThemeState(storedTheme);

        const resolved = storedTheme === 'system' ? getSystemTheme() : storedTheme;
        setResolvedTheme(resolved);
        applyTheme(resolved);

        setMounted(true);
    }, []);

    // Listen for system theme changes
    useEffect(() => {
        if (theme !== 'system') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

        const handleChange = (e: MediaQueryListEvent) => {
            const newResolved = e.matches ? 'dark' : 'light';
            setResolvedTheme(newResolved);
            applyTheme(newResolved);
        };

        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, [theme]);

    const setTheme = useCallback((newTheme: Theme) => {
        setThemeState(newTheme);

        try {
            localStorage.setItem(STORAGE_KEY, newTheme);
        } catch {
            // localStorage not available
        }

        const resolved = newTheme === 'system' ? getSystemTheme() : newTheme;
        setResolvedTheme(resolved);
        applyTheme(resolved);
    }, []);

    const toggleTheme = useCallback(() => {
        const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
        setTheme(nextTheme);
    }, [resolvedTheme, setTheme]);

    // Prevent flash of wrong theme during SSR
    if (!mounted) {
        return (
            <ThemeContext.Provider value={{ theme: 'system', resolvedTheme: 'light', setTheme: () => { }, toggleTheme: () => { } }}>
                {children}
            </ThemeContext.Provider>
        );
    }

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

// Theme Toggle Button Component with beautiful animations
export function ThemeToggle({ className = '' }: { className?: string }) {
    const { resolvedTheme, toggleTheme, theme, setTheme } = useTheme();
    const [isOpen, setIsOpen] = useState(false);
    const isDark = resolvedTheme === 'dark';

    return (
        <div className="relative">
            <button
                type="button"
                onClick={toggleTheme}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setIsOpen(!isOpen);
                }}
                className={`
          group relative flex h-9 w-9 items-center justify-center rounded-full
          transition-all duration-200 ease-out
          hover:scale-105 active:scale-95
          ${isDark
                        ? 'bg-slate-700/50 hover:bg-slate-600/50 text-amber-300'
                        : 'bg-slate-100 hover:bg-slate-200 text-amber-500'
                    }
          ${className}
        `}
                title={`Switch to ${isDark ? 'light' : 'dark'} mode (right-click for options)`}
                aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
                {/* Sun icon */}
                <svg
                    className={`
            absolute h-5 w-5 transition-all duration-300 ease-out
            ${isDark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100'}
          `}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <circle cx="12" cy="12" r="5" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>

                {/* Moon icon */}
                <svg
                    className={`
            absolute h-5 w-5 transition-all duration-300 ease-out
            ${isDark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0'}
          `}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                >
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>

                {/* Hover glow effect */}
                <span
                    className={`
            absolute inset-0 rounded-full opacity-0 transition-opacity duration-300
            group-hover:opacity-100
            ${isDark ? 'shadow-[0_0_15px_rgba(251,191,36,0.3)]' : 'shadow-[0_0_15px_rgba(251,191,36,0.2)]'}
          `}
                />
            </button>

            {/* Dropdown for theme options */}
            {isOpen && (
                <>
                    <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className={`
            absolute right-0 top-full z-50 mt-2 w-36 overflow-hidden rounded-xl
            shadow-lg border
            ${isDark
                            ? 'bg-slate-800 border-slate-700'
                            : 'bg-white border-slate-200'
                        }
          `}>
                        {(['light', 'dark', 'system'] as const).map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => {
                                    setTheme(option);
                                    setIsOpen(false);
                                }}
                                className={`
                  flex w-full items-center gap-2 px-3 py-2 text-sm capitalize
                  transition-colors duration-150
                  ${theme === option
                                        ? isDark ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-900'
                                        : isDark ? 'text-slate-300 hover:bg-slate-700/50' : 'text-slate-600 hover:bg-slate-50'
                                    }
                `}
                            >
                                {option === 'light' && (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <circle cx="12" cy="12" r="5" />
                                        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                                    </svg>
                                )}
                                {option === 'dark' && (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                                    </svg>
                                )}
                                {option === 'system' && (
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <rect x="2" y="3" width="20" height="14" rx="2" />
                                        <path d="M8 21h8M12 17v4" />
                                    </svg>
                                )}
                                {option}
                                {theme === option && (
                                    <svg className="ml-auto h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                        <path d="M5 13l4 4L19 7" />
                                    </svg>
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

export default ThemeProvider;
